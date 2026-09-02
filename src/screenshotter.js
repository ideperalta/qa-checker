// Screenshots disabled on free tier — returns null gracefully
async function takeScreenshots(baselineUrl, challengerUrl) {
  console.log('  📸 Screenshots disabled on free tier — skipping');
  return {
    baseline:   null,
    challenger: null,
    success:    false
  };
}

module.exports = { takeScreenshots };