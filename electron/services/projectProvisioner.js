const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCommandInvoker, createDefaultRunner } = require('./projectProvisioner/commandRunner');
const { ProvisioningError, publicError, normalizeForComparison, sanitizeText } = require('./projectProvisioner/core');
const { configureFirebase } = require('./projectProvisioner/firebaseAdapter');
const { deployVercel, getRuntimeOptions, preflightProviders, publishGitHub } = require('./projectProvisioner/remoteAdapters');
const { installBackendClients, scaffoldProject } = require('./projectProvisioner/scaffold');
const { configureSupabase, createSupabaseProjectViaApi } = require('./projectProvisioner/supabaseAdapter');
const { analyzeWorkspace } = require('./workspaceAnalyzer');
const { toPublicProject } = require('./projectContracts');
const {
  assertWindows,
  createGrantStore,
  getDefaultProjectsRoot,
  getProvisioningOptions,
  validateRequest,
} = require('./projectProvisioner/validation');

function clonePublicState(state) {
  const cloned = JSON.parse(JSON.stringify(state));
  if (cloned.project) cloned.project = toPublicProject(cloned.project);
  return cloned;
}

function createProjectProvisioner({
  registerProject = async (projectPath, metadata) => ({ path: projectPath, ...metadata }),
  workspaceAnalyzer = analyzeWorkspace,
  onProgress = () => {},
  runner = createDefaultRunner(),
  fsImpl = fs,
  platform = process.platform,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  dialog: injectedDialog,
  supabaseProjectCreator = createSupabaseProjectViaApi,
} = {}) {
  const grants = createGrantStore({ fsImpl, platform, now, randomUUID });
  const active = new Map();
  const invoke = createCommandInvoker(runner);

  function emit(state, stage, status, message, percent) {
    const event = { id: state.id, stage, status, message: sanitizeText(message), percent };
    try { onProgress(event); } catch {}
  }

  function createLocationGrant(parentPath) {
    return grants.create(parentPath);
  }

  async function chooseLocationGrant(browserWindow) {
    assertWindows(platform);
    let dialog = injectedDialog;
    if (!dialog) dialog = require('electron').dialog;
    if (!dialog?.showOpenDialog) {
      throw new ProvisioningError('DIALOG_UNAVAILABLE', 'The folder picker is unavailable.');
    }
    const result = await dialog.showOpenDialog(browserWindow, {
      title: 'Choose a parent folder for the new project',
      buttonLabel: 'Use this folder',
      defaultPath: getDefaultProjectsRoot(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return createLocationGrant(result.filePaths[0]);
  }

  async function stage(state, name, percent, message, operation) {
    state.steps[name] = { status: 'running' };
    state.currentStage = name;
    emit(state, name, 'running', message, percent);
    try {
      const value = await operation();
      state.steps[name] = { status: 'completed' };
      emit(state, name, 'completed', message, percent);
      return value;
    } catch (error) {
      const cancelled = error?.code === 'CANCELLED' || error?.name === 'AbortError';
      state.steps[name] = { status: cancelled ? 'cancelled' : 'failed' };
      emit(state, name, state.steps[name].status, cancelled ? 'Provisioning cancelled.' : 'This step could not be completed.', percent);
      throw error;
    }
  }

  async function provisionProject(rawRequest, locationGrant) {
    assertWindows(platform);
    if (active.size > 0) {
      throw new ProvisioningError('PROVISIONING_ACTIVE', 'Another project is already being provisioned.');
    }
    const request = validateRequest(rawRequest);
    const parentPath = grants.consume(locationGrant);
    const projectPath = path.join(parentPath, request.slug);
    if (normalizeForComparison(path.dirname(projectPath)) !== normalizeForComparison(parentPath)) {
      throw new ProvisioningError('INVALID_PROJECT_PATH', 'The generated project path is outside the approved location.');
    }
    if (fsImpl.existsSync(projectPath)) {
      throw new ProvisioningError('PROJECT_EXISTS', 'A file or folder already exists at the project path.');
    }

    const id = randomUUID();
    const job = { id, controller: new AbortController() };
    const state = {
      id,
      status: 'running',
      retryable: false,
      name: request.name,
      slug: request.slug,
      type: request.type,
      backend: request.backend,
      projectPath,
      currentStage: null,
      steps: {},
      remotes: {},
      remoteCreationAttempted: false,
      localCreated: false,
      localRolledBack: false,
    };
    active.set(id, job);

    try {
      await stage(state, 'scaffold', 8, 'Creating the local project structure.', () => scaffoldProject({
        job, request, projectPath, state, invoke, fsImpl,
      }));
      await stage(state, 'git-init', 18, 'Initializing the local Git repository.', async () => {
        await invoke(job, 'git', ['init', '--initial-branch=main'], projectPath);
      });
      const accounts = await stage(state, 'preflight', 28, 'Checking active provider accounts.', () => preflightProviders({
        job, request, projectPath, invoke,
      }));
      if (request.backend === 'firebase') {
        await stage(state, 'backend', 43, 'Creating Firebase Spark resources and Firestore configuration.', () => configureFirebase({
          job, request, state, invoke, fsImpl,
        }));
      } else if (request.backend === 'supabase') {
        await stage(state, 'backend', 43, 'Creating the Supabase Nano project and public client configuration.', () => configureSupabase({
          job, request, state, invoke, projectCreator: supabaseProjectCreator, fsImpl,
        }));
      } else {
        state.steps.backend = { status: 'skipped' };
      }
      await stage(state, 'clients', 56, 'Installing and configuring the selected backend SDKs.', () => installBackendClients({
        job, request, state, invoke, fsImpl,
      }));
      await stage(state, 'git-commit', 65, 'Creating the initial source commit.', async () => {
        await invoke(job, 'git', ['add', '--all'], projectPath);
        await invoke(job, 'git', ['commit', '-m', 'Initial project scaffold'], projectPath);
      });
      await stage(state, 'github', 74, 'Creating and pushing the private GitHub repository.', () => publishGitHub({
        job, request, state, accounts, invoke,
      }));
      await stage(state, 'vercel', 88, 'Creating Vercel and connecting the GitHub repository.', () => deployVercel({
        job, request, state, accounts, invoke,
      }));
      await stage(state, 'register', 96, 'Registering the project in Vibe IDE Coder.', async () => {
        const workspace = await workspaceAnalyzer(projectPath);
        state.project = await registerProject(projectPath, {
          name: request.name,
          slug: request.slug,
          type: request.type,
          stack: request.stack,
          backend: request.backend,
          repositoryVisibility: request.repository?.visibility,
          deploymentProvider: request.deployment?.provider,
          origin: 'provisioned',
          registeredAt: now(),
          primaryTargetId: workspace.recommendedTargetId,
          workspace,
        });
      });
      state.status = 'completed';
      state.currentStage = null;
      state.repository = state.remotes.github;
      state.deployment = state.remotes.vercel;
      emit(state, 'complete', 'completed', 'Project provisioned successfully.', 100);
      return clonePublicState(state);
    } catch (error) {
      state.status = error?.code === 'CANCELLED' || error?.name === 'AbortError' ? 'cancelled' : 'failed';
      state.retryable = !state.remoteCreationAttempted;
      state.partial = state.localCreated || state.remoteCreationAttempted;
      state.manualCleanupRequired = state.remoteCreationAttempted;
      state.error = publicError(error);
      state.message = state.error.message;
      state.repository = state.remotes.github;
      state.deployment = state.remotes.vercel;
      if (fsImpl.existsSync(projectPath) && !state.project) {
        try {
          const workspace = await workspaceAnalyzer(projectPath);
          state.project = await registerProject(projectPath, {
            name: request.name,
            slug: request.slug,
            type: request.type,
            stack: request.stack,
            backend: request.backend,
            repositoryVisibility: request.repository?.visibility,
            deploymentProvider: request.deployment?.provider,
            provisioningStatus: 'partial',
            origin: 'provisioned',
            registeredAt: now(),
            primaryTargetId: workspace.recommendedTargetId,
            workspace,
          });
        } catch {}
      }
      return clonePublicState(state);
    } finally {
      active.delete(id);
    }
  }

  function cancelProvisioning() {
    let cancelled = 0;
    for (const job of active.values()) {
      if (!job.controller.signal.aborted) {
        job.controller.abort();
        cancelled += 1;
      }
    }
    return { success: true, cancelled };
  }

  function terminateAllProvisions() {
    const result = cancelProvisioning();
    if (typeof runner?.terminateAll === 'function') runner.terminateAll();
    return result;
  }

  return {
    getDefaultProjectsRoot,
    createLocationGrant,
    chooseLocationGrant,
    getProvisioningOptions,
    getRuntimeOptions: () => getRuntimeOptions(runner),
    provisionProject,
    cancelProvisioning,
    terminateAllProvisions,
  };
}

const defaultProvisioner = createProjectProvisioner();
const configuredIpc = new WeakMap();

function createLocationGrant(parentPath) {
  return defaultProvisioner.createLocationGrant(parentPath);
}

function chooseLocationGrant(browserWindow) {
  return defaultProvisioner.chooseLocationGrant(browserWindow);
}

function provisionProject(request, locationGrant) {
  return defaultProvisioner.provisionProject(request, locationGrant);
}

function cancelProvisioning() {
  return defaultProvisioner.cancelProvisioning();
}

function terminateAllProvisions() {
  return defaultProvisioner.terminateAllProvisions();
}

function setupProjectProvisionerHandlers(ipcMain, getMainWindow, registerProject) {
  if (!ipcMain?.handle) throw new TypeError('ipcMain.handle is required.');
  if (configuredIpc.has(ipcMain)) return configuredIpc.get(ipcMain);
  const instance = createProjectProvisioner({
    registerProject,
    onProgress(event) {
      const mainWindow = getMainWindow?.();
      if (mainWindow && !mainWindow.isDestroyed?.()) {
        mainWindow.webContents.send('projects:provisioning-progress', event);
      }
    },
  });
  ipcMain.handle('projects:get-provisioning-options', () => instance.getRuntimeOptions());
  ipcMain.handle('projects:get-default-root', () => {
    const root = instance.getDefaultProjectsRoot();
    fs.mkdirSync(root, { recursive: true });
    return instance.createLocationGrant(root);
  });
  ipcMain.handle('projects:choose-location', () => instance.chooseLocationGrant(getMainWindow?.()));
  ipcMain.handle('projects:provision', (_event, request, grant) => instance.provisionProject(request, grant));
  ipcMain.handle('projects:cancel-provisioning', () => instance.cancelProvisioning());
  configuredIpc.set(ipcMain, instance);
  return instance;
}

module.exports = {
  createProjectProvisioner,
  getDefaultProjectsRoot,
  createLocationGrant,
  chooseLocationGrant,
  getProvisioningOptions,
  provisionProject,
  cancelProvisioning,
  terminateAllProvisions,
  setupProjectProvisionerHandlers,
  createSupabaseProjectViaApi,
};
