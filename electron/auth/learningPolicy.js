const LEARNING_ORIGIN = 'https://vibe-ide-code.vercel.app';

function isTrustedLearningUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === LEARNING_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

module.exports = { LEARNING_ORIGIN, isTrustedLearningUrl };
