// Extend expect with custom matchers similar to @testing-library/jest-dom
expect.extend({
  toBeInTheDocument(received: any) {
    const pass = received != null && document.documentElement.contains(received);
    return {
      pass,
      message: () =>
        `expected element ${pass ? 'not ' : ''}to be in the document`,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeInTheDocument(): R;
    }
  }
}
