'use strict';
const fs = require('fs');
const path = require('path');

function hasLangs(obj) {
  return Boolean(obj)
    && typeof obj.ru === 'string' && obj.ru.trim() !== ''
    && typeof obj.en === 'string' && obj.en.trim() !== '';
}

function validateQuestions(data, imgDir) {
  if (!data || !Array.isArray(data.themes) || data.themes.length === 0) {
    return ['themes: must be a non-empty array'];
  }
  const errors = [];
  let bagCount = 0;
  data.themes.forEach((theme, t) => {
    const where = `themes[${t}]`;
    if (!hasLangs(theme.name)) errors.push(`${where}.name: needs ru and en`);
    if (!Array.isArray(theme.questions) || theme.questions.length === 0) {
      errors.push(`${where}.questions: must be a non-empty array`);
      return;
    }
    const values = new Set();
    theme.questions.forEach((q, i) => {
      const w = `${where}.questions[${i}]`;
      if (!Number.isInteger(q.value) || q.value <= 0) errors.push(`${w}.value: must be a positive integer`);
      else if (values.has(q.value)) errors.push(`${w}.value: duplicate ${q.value} in theme`);
      values.add(q.value);
      if (!hasLangs(q.text)) errors.push(`${w}.text: needs ru and en`);
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        errors.push(`${w}.options: must have exactly 4`);
      } else {
        q.options.forEach((o, k) => { if (!hasLangs(o)) errors.push(`${w}.options[${k}]: needs ru and en`); });
      }
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) errors.push(`${w}.correct: must be 0..3`);
      if (q.image != null && (typeof q.image !== 'string' || !fs.existsSync(path.join(imgDir, q.image)))) {
        errors.push(`${w}.image: file not found in public/img: ${q.image}`);
      }
      if (q.bag === true) bagCount += 1;
    });
  });
  if (bagCount !== 1) errors.push(`bag: exactly one question must have "bag": true (found ${bagCount})`);
  return errors;
}

function loadQuestions(file, imgDir) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateQuestions(data, imgDir);
  if (errors.length) throw new Error(`questions.json is invalid:\n  ${errors.join('\n  ')}`);
  return data;
}

module.exports = { validateQuestions, loadQuestions };
