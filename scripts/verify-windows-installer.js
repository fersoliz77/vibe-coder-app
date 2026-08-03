const fs = require('node:fs');
const path = require('node:path');

const MACHINES = new Map([[0x014c, 'x86'], [0x8664, 'x64'], [0xaa64, 'arm64']]);
const MIN_INSTALLER_BYTES = 1024 * 1024;
const MIN_OVERLAY_BYTES = 1024 * 1024;

function inspectPe(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 512) throw new Error('artifact is not a non-empty PE file');
  const descriptor = fs.openSync(resolved, 'r');
  const header = Buffer.alloc(Math.min(stat.size, 128 * 1024));
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (header.toString('ascii', 0, 2) !== 'MZ') throw new Error('missing DOS MZ header');
  const peOffset = header.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 24 > header.length || header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('missing or out-of-bounds PE header');
  }
  const machineCode = header.readUInt16LE(peOffset + 4);
  const sectionCount = header.readUInt16LE(peOffset + 6);
  const optionalSize = header.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  if (sectionCount < 1 || sectionCount > 96) throw new Error(`invalid PE section count: ${sectionCount}`);
  if (optionalOffset + optionalSize > header.length) throw new Error('out-of-bounds PE optional header');
  const magic = header.readUInt16LE(optionalOffset);
  const minimumOptionalSize = magic === 0x10b ? 136 : magic === 0x20b ? 152 : 0;
  if (!minimumOptionalSize || optionalSize < minimumOptionalSize) throw new Error('invalid PE optional header');
  const subsystem = header.readUInt16LE(optionalOffset + 68);
  if (subsystem !== 2) throw new Error(`expected Windows GUI subsystem (2), found ${subsystem}`);
  const sizeOfHeaders = header.readUInt32LE(optionalOffset + 60);
  if (sizeOfHeaders < optionalOffset + optionalSize || sizeOfHeaders > stat.size) throw new Error('invalid PE SizeOfHeaders');
  const sectionTableOffset = optionalOffset + optionalSize;
  if (sectionTableOffset + (sectionCount * 40) > header.length) throw new Error('out-of-bounds PE section table');
  let imageEnd = sizeOfHeaders;
  for (let index = 0; index < sectionCount; index += 1) {
    const sectionOffset = sectionTableOffset + (index * 40);
    const rawSize = header.readUInt32LE(sectionOffset + 16);
    const rawOffset = header.readUInt32LE(sectionOffset + 20);
    if (rawSize === 0) continue;
    const rawEnd = rawOffset + rawSize;
    if (rawOffset < sizeOfHeaders || rawEnd > stat.size || rawEnd < rawOffset) throw new Error(`section ${index} has invalid file bounds`);
    imageEnd = Math.max(imageEnd, rawEnd);
  }
  const dataDirectoryOffset = optionalOffset + (magic === 0x10b ? 96 : 112);
  const certificateOffset = header.readUInt32LE(dataDirectoryOffset + (8 * 4));
  const certificateSize = header.readUInt32LE(dataDirectoryOffset + (8 * 4) + 4);
  if ((certificateOffset === 0) !== (certificateSize === 0)) throw new Error('incomplete PE certificate table entry');
  if (certificateSize > 0 && (certificateOffset < imageEnd || certificateOffset + certificateSize > stat.size)) {
    throw new Error('PE certificate table is out of bounds');
  }
  return {
    path: resolved,
    size: stat.size,
    machine: MACHINES.get(machineCode) || `unknown-0x${machineCode.toString(16)}`,
    peFormat: magic === 0x20b ? 'PE32+' : 'PE32',
    subsystem: 'Windows GUI',
    imageEnd,
    overlayBytes: stat.size - imageEnd,
    authenticode: certificateSize > 0 ? 'present/not-verified' : 'absent',
  };
}

function inspectWindowsInstaller(installerPath, unpackedAppPath) {
  const packageVersion = require('../package.json').version;
  const expectedInstallerName = `Vibe IDE Code Setup ${packageVersion}.exe`;
  if (path.basename(installerPath) !== expectedInstallerName) throw new Error(`installer must be named ${expectedInstallerName}`);
  const installer = inspectPe(installerPath);
  if (installer.size < MIN_INSTALLER_BYTES) throw new Error(`installer must be at least ${MIN_INSTALLER_BYTES} bytes`);
  if (installer.overlayBytes < MIN_OVERLAY_BYTES) throw new Error(`installer must contain at least ${MIN_OVERLAY_BYTES} overlay bytes`);

  let unpackedApp = null;
  if (unpackedAppPath) {
    if (path.basename(unpackedAppPath) !== 'Vibe IDE Code.exe' || path.basename(path.dirname(path.resolve(unpackedAppPath))) !== 'win-unpacked') {
      throw new Error('unpacked app must be win-unpacked/Vibe IDE Code.exe');
    }
    unpackedApp = inspectPe(unpackedAppPath);
    if (unpackedApp.machine !== 'x64') throw new Error(`unpacked app must be x64, found ${unpackedApp.machine}`);
  }
  return { installer, unpackedApp };
}

if (require.main === module) {
  try {
    if (!process.argv[2] || !process.argv[3]) {
      throw new Error('usage: node scripts/verify-windows-installer.js <installer.exe> <win-unpacked/Vibe IDE Code.exe>');
    }
    const result = inspectWindowsInstaller(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    console.log('PE structure only. Installer format and Authenticode trust were not verified.');
  } catch (error) {
    console.error(`Windows artifact verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { inspectPe, inspectWindowsInstaller };
