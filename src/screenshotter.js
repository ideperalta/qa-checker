// Screenshots disabled
async function takeScreenshots(baselineUrl, challengerUrl) {
  console.log('  📸 Screenshots disabled — skipping');
  return { baseline: null, challenger: null, success: false };
}
module.exports = { takeScreenshots };