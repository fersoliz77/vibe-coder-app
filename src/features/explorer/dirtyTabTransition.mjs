export async function resolveDirtyTabTransition(choice, { save, discard }) {
  if (choice === 'cancel') return false;
  if (choice === 'discard') {
    discard();
    return true;
  }
  if (choice === 'save') return Boolean(await save());
  return false;
}
