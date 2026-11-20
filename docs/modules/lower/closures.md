# Local async lowering

`lowerClosures(source, checker)` turns eligible local async arrows into private methods on their original class. Explicit capture parameters retain the receiver and access to private members. Recursive calls and immediate invocations call the generated method. Baguette's `nativeMethod`, `nativeParameter`, `nativeProperty` and `nativeVariable` factories construct its input syntax.

Immutable captures pass their existing values. Mutable locals use typed cells allocated in the original invocation, shared with ordinary reads and writes and with other lifted functions. Each outer invocation owns its cells. A source-content hash and checked local names identify generated declarations.

Baguette performs coroutine frame generation and suspension. Tests compare recursive calls, concurrent callbacks, default parameters, destructured captures and thrown failures with the original TypeScript. The compiled fixture exercises capture cells, recursion and private member access in native WebAssembly, then rebuilds the modular WAT independently.

Promise handlers retain a synchronous arrow that returns the generated async method's promise. The original then, catch or finally call performs settlement and schedules the handler. Inferred handler parameters receive their original checked types. Differential tests cover rejection, finalisation, shared capture state and an interleaved observer.
