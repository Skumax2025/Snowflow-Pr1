/**
 * Валидатор ответа модели по JSON-схеме.
 *
 * Схема лежит в конфиге (`proxy.responseSchema`), а не в коде: требование
 * теста «валидация ответа LLM по схеме — схема в конфиге, не в коде».
 * Диалект минимальный: ровно то, что нужно для claims/tone/offtopic.
 */

import type { SchemaNode } from "../config/types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainstSchema(value: unknown, schema: SchemaNode, path = "$"): ValidationResult {
  const errors: string[] = [];
  check(value, schema, path, errors);
  return { valid: errors.length === 0, errors };
}

function check(value: unknown, schema: SchemaNode, path: string, errors: string[]): void {
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${path}: ожидался объект`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key}: обязательное поле отсутствует`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in record) check(record[key], sub, `${path}.${key}`, errors);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path}: ожидался массив`);
        return;
      }
      if (schema.items) {
        value.forEach((item, index) => check(item, schema.items as SchemaNode, `${path}[${index}]`, errors));
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${path}: ожидалась строка`);
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: значение вне перечисления`);
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path}: ожидалось число`);
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: меньше минимума`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: больше максимума`);
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${path}: ожидалось булево`);
      return;
    }
    default:
      errors.push(`${path}: неизвестный тип схемы`);
  }
}
