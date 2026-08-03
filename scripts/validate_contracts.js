const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'tests', 'contracts', 'ecosystem-contracts.snapshot.json');

function loadContractSnapshot() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  if (snapshot?._snapshot?.source !== 'ecosystem/02-architecture/contracts'
    || snapshot?._snapshot?.version !== '1.0.0') {
    throw new Error('Contract snapshot header is missing or unsupported.');
  }
  return snapshot;
}

function validateContract(schema, value, location = '$') {
  const errors = [];
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const normalizedType = actualType === 'number' && Number.isInteger(value) ? 'integer' : actualType;

  if (schema.type && !allowedTypes.includes(actualType) && !allowedTypes.includes(normalizedType)) {
    return [`${location} must be ${allowedTypes.join(' or ')}`];
  }
  if (value === null) return errors;
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location} is not in the enum`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${location} is too short`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${location} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} has an invalid pattern`);
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) errors.push(`${location} is not a UUID`);
    if (schema.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`${location} is not an email`);
    if (schema.format === 'date-time' && (!value.includes('T') || !Number.isFinite(Date.parse(value)))) errors.push(`${location} is not a date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${location} is below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${location} is above maximum`);
  }
  if (actualType === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateContract(childSchema, value[key], `${location}.${key}`));
    }
  }
  return errors;
}

module.exports = { loadContractSnapshot, validateContract };
