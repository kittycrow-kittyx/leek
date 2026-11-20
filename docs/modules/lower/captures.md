# Local capture analysis

`closureUnits(source, checker)` selects local arrows called directly from an instance method, immediate invocations and handlers passed to standard Promise methods. Each `ClosureUnit` records whether the arrow is async, the owning class and method, call sites, callback form, explicit return type and `CapturedVariable` records. A capture contains its original symbol, binding, declaration, type and mutability.

The analysis checks every reference to a local function before lifting it. Function values returned or passed to another function retain their original form. Captured bindings must be initialised before the arrow. A mutable local needs a simple initialiser; written parameters, unresolved types, local callable captures and generic owning methods await further lowering. Declaration ranges are compared only within the same source file.

Calls must retain the owning method's receiver. References inside a nested ordinary function or class retain their original form. Generic arrows that shadow a class type parameter also retain their source form.

Closure lifting accepts void results and native value types. Captures, parameters or results containing undefined or nullable primitives retain their closures pending optional storage.

`parameterWritten(root, symbol, checker)` scans assignment targets, including destructuring, for writes to a binding. Optional-number consumer analysis also uses this check for helper parameters and function bindings.
