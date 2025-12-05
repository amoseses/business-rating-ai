from jsonschema import validate
SCHEMA = {
  "type": "object",
  "properties": {
    "scores": {
      "type": "object",
      "properties": {
        "team": {"type": "number", "minimum": 1, "maximum": 10},
        "market": {"type": "number", "minimum": 1, "maximum": 10},
        "product": {"type": "number", "minimum": 1, "maximum": 10},
        "financials": {"type": "number", "minimum": 1, "maximum": 10},
        "risk": {"type": "number", "minimum": 1, "maximum": 10},
        "overall": {"type": "number", "minimum": 1, "maximum": 10}
      },
      "required": ["team","market","product","financials","risk","overall"]
    },
    "justification": {"type": "string"}
  },
  "required": ["scores","justification"]
}
def validate_rating(obj):
  validate(instance=obj, schema=SCHEMA)
  for k in obj['scores']:
    obj['scores'][k] = float(obj['scores'][k])
  return obj
