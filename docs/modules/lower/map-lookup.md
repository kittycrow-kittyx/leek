# Map lookup facts

`mapLookup(expression, checker)` recognises a standard Map get call with one argument and concrete non-nullable key and value types. `MapLookup` records the receiver, key, their checking types and the value type. Nullable default selection and optional Number consumers share this analysis.
