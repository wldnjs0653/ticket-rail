const rawEvery =
  process.env.CONSUMER_SUCCESS_LOG_EVERY || '1';

const every = Number.parseInt(rawEvery, 10);

if (!Number.isInteger(every) || every < 1) {
  throw new Error(
    'CONSUMER_SUCCESS_LOG_EVERY must be a positive integer'
  );
}

function createSampledLogger() {
  let count = 0;

  return (...args) => {
    count += 1;

    if (every === 1 || count % every === 0) {
      console.log(...args);
    }
  };
}

module.exports = {
  createSampledLogger,
};
