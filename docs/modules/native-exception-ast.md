# Native exception syntax adapter

`nativeExceptionAst(parser)` extends the public AssemblyScript syntax tree during compilation. Standard-library throws evaluate their original Error expression through the native tag operation. A terminating synthetic throw retains the compiler's definite-assignment and narrowing facts; native control flow exits before that abort path.

Existing Baguette task classes gain a rooted Error field and a rejection method. Their existing completion and continuation machinery still performs scheduling. Resume reads rethrow stored failures, and generated coroutine frames catch those failures and reject their original tasks. No separate Promise scheduler is introduced.

Generated members are attached to the original source ranges before compiler initialisation. Unsupported frame or task shapes fail explicitly. This adapter does not by itself lower source try/catch regions across coroutine states.

For Baguette-generated `__BqFrame_*`, `__BqTask`, `__BqTaskVoid` and `__BqContinuation` classes, clear definite-assignment assertions only for fields assigned directly and unconditionally in their constructor. Deferred await results and conditionally assigned fields retain their assertions, so non-null reference fields are not incorrectly required before their generated resume state assigns them. Assertions in canonical kernel and userspace classes are preserved. Pinned Baguette sources remain unchanged.
