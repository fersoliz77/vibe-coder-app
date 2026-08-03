const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const CHANNELS = new Set(['internal', 'pilot', 'stable']);
const SEMVER_PATTERN = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';
const STABLE_SEMVER_PATTERN = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';
const URL_PATTERN = '^https://(?![^/?#]*@)[^/?#]+/[^?#]*\\.exe(?:[?#].*)?$';
const RFC3339_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z$';
const SEMVER = new RegExp(SEMVER_PATTERN);
const STABLE_SEMVER = new RegExp(STABLE_SEMVER_PATTERN);
const RELEASE_URL = new RegExp(URL_PATTERN);
const RFC3339 = new RegExp(RFC3339_PATTERN);
const SHA256 = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = ['version', 'channel', 'url', 'sha256', 'size', 'compatibility', 'publishedAt'];
const COMPATIBILITY_KEYS = ['minimumBackendVersion', 'minimumClientVersion'];

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function expandIpv6(hostname) {
  const parts = hostname.toLowerCase().split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isDisallowedIp(hostname) {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const [a, b] = hostname.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (ipVersion !== 6) return false;
  const groups = expandIpv6(hostname);
  if (!groups) return true;
  const unspecified = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const mappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
    ? `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    : null;
  return unspecified || loopback || uniqueLocal || linkLocal || (mappedIpv4 ? isDisallowedIp(mappedIpv4) : false);
}

function isReleaseUrl(value, channel) {
  try {
    if (typeof value !== 'string' || !RELEASE_URL.test(value)) return false;
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || !parsed.pathname.endsWith('.exe')) return false;
    if (parsed.hostname.endsWith('.')) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isDisallowedIp(hostname)) return false;
    if ((hostname === 'invalid' || hostname.endsWith('.invalid')) && channel !== 'internal') return false;
    return true;
  } catch {
    return false;
  }
}

function isRfc3339DateTime(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(match[1]);
  const day = Number(match[2]);
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function validateReleaseManifest(manifest) {
  const errors = [];
  if (!exactKeys(manifest, TOP_LEVEL_KEYS)) errors.push(`manifest must contain only: ${TOP_LEVEL_KEYS.join(', ')}`);
  if (!SEMVER.test(manifest?.version || '')) errors.push('version must be a strict semantic version');
  if (!CHANNELS.has(manifest?.channel)) errors.push('channel must be internal, pilot, or stable');
  if (manifest?.channel === 'stable' && !STABLE_SEMVER.test(manifest?.version || '')) errors.push('stable releases cannot use a prerelease version');
  if (!isReleaseUrl(manifest?.url, manifest?.channel)) errors.push('url must be an HTTPS .exe URL without credentials, local/private addresses, or trailing-dot hosts; .invalid placeholders are internal-only');
  if (!SHA256.test(manifest?.sha256 || '')) errors.push('sha256 must be 64 lowercase hexadecimal characters');
  if (!Number.isSafeInteger(manifest?.size) || manifest.size < 1) errors.push('size must be an integer from 1 through 9007199254740991');
  if (!exactKeys(manifest?.compatibility, COMPATIBILITY_KEYS)) {
    errors.push(`compatibility must contain only: ${COMPATIBILITY_KEYS.join(', ')}`);
  }
  if (!SEMVER.test(manifest?.compatibility?.minimumBackendVersion || '')) errors.push('minimumBackendVersion must be a strict semantic version');
  if (!SEMVER.test(manifest?.compatibility?.minimumClientVersion || '')) errors.push('minimumClientVersion must be a strict semantic version');
  if (!isRfc3339DateTime(manifest?.publishedAt)) errors.push('publishedAt must use the accepted RFC 3339 policy: UTC Z, seconds, and up to 9 fractional digits');
  return errors;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyManifestArtifact(manifest, installerPath) {
  const errors = validateReleaseManifest(manifest);
  if (errors.length) return errors;
  let stat;
  try {
    stat = fs.statSync(installerPath);
  } catch (error) {
    return [`installer cannot be read: ${error.message}`];
  }
  if (!stat.isFile()) return ['installer path is not a file'];
  if (stat.size !== manifest.size) errors.push(`size mismatch: manifest=${manifest.size}, installer=${stat.size}`);
  const actualHash = await sha256File(installerPath);
  if (actualHash !== manifest.sha256) errors.push(`sha256 mismatch: manifest=${manifest.sha256}, installer=${actualHash}`);
  return errors;
}

async function verifyChecksumFile(checksumPath, installerPath) {
  const resolvedChecksum = path.resolve(checksumPath);
  const contents = fs.readFileSync(resolvedChecksum, 'utf8');
  const match = /^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/.exec(contents);
  if (!match) return ['checksum file must contain one lowercase SHA-256 and one relative path'];
  const recordedTarget = path.resolve(path.dirname(resolvedChecksum), match[2].replaceAll('/', path.sep));
  const resolvedInstaller = path.resolve(installerPath);
  if (recordedTarget.toLowerCase() !== resolvedInstaller.toLowerCase()) return ['checksum relative path does not resolve to the installer'];
  const actualHash = await sha256File(resolvedInstaller);
  return actualHash === match[1] ? [] : [`checksum mismatch: file=${match[1]}, installer=${actualHash}`];
}

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
}

module.exports = {
  RFC3339_PATTERN,
  SEMVER_PATTERN,
  STABLE_SEMVER_PATTERN,
  URL_PATTERN,
  isReleaseUrl,
  readManifest,
  sha256File,
  validateReleaseManifest,
  verifyChecksumFile,
  verifyManifestArtifact,
};
