```baton-slice-v1
{
  "schema_version": "baton.slice/v1",
  "id": "S1",
  "outcome": "A user can export the visible report as CSV.",
  "scope": {
    "include": ["src/report/export.mjs"],
    "exclude": []
  },
  "acceptance": [
    {
      "id": "A1",
      "text": "The downloaded CSV contains every row and total shown in the report."
    }
  ],
  "checks": ["check-report-csv-parity"],
  "constraints": ["Merge only the exact candidate that passes verification."],
  "depends_on": [],
  "consumes": []
}
```

# Slice contract

Keep this file limited to the promised behavior, product scope, acceptance,
minimum checks, constraints, and real delivery inputs for one stable slice.
