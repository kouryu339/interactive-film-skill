// The example provider supplies this module as its runtime dependency.
export const calculateScore = attempts => Math.max(0, 100 - (attempts - 1) * 20);
