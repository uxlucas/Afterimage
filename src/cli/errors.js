// Errors the user can act on (a bad name, a lock, a failed build) print as one message. These built-in types mean a
// bug in Afterimage itself, so they keep their stack for the bug report.
const programmerErrors = [TypeError, ReferenceError, SyntaxError, RangeError, EvalError];

export const isUserError = error => error instanceof Error && !programmerErrors.some(type => error instanceof type);
