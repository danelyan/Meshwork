/**
 * Эвристика «в тексте похоже на инструкцию для модели» → `flags.injectionSuspect`.
 * Это только сигнал для UI и журнала: защита – в том, что текст идёт в модель как
 * данные, а уровень доказанности ставит код (research/10 § 4.6). Проверяется весь
 * текст, включая скрытые строки, комментарии и meta.
 */
const PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|the)\b[^.\n]{0,20}\b(instructions?|rules|prompts?|guidelines)\b/i,
  /\b(игнорируй|проигнорируй|забудь|отмени|не\s+соблюдай)\b[^.\n]{0,40}\b(инструкци\p{L}*|указани\p{L}*|правил\p{L}*|промпт\p{L}*)/iu,
  /\bsystem\s*(prompt|override|message)\b/i,
  /системн\p{L}*\s+(промпт|подсказк|инструкци|сообщени)/iu,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /\b(instructions?|note|message)\s+(for|to)\s+(the\s+)?(llm|ai|assistant|model|agent|gpt|reviewers?)\b/i,
  /\b(ai|llm)\s+(assistant|agent|reviewers?)s?\b\s*[:,]/i,
  /для\s+(ии|ai|llm|нейросет\p{L}*|ассистент\p{L}*|модел\p{L}*)/iu,
  /\b(new|updated)\s+(priority\s+)?(instructions?|task|rules)\b/i,
  /нов\p{L}*\s+(инструкци\p{L}*|задач\p{L}*|правил\p{L}*)\s*(от|:)/iu,
  /\b(do\s+not|don't)\s+(tell|mention|reveal|inform)\b[^.\n]{0,30}\b(user|this|comment|instruction)/i,
  /не\s+(сообщай|говори|упоминай|раскрывай)\b/iu,
  /\b(evidence_level|third_party)\b/i,
  /режим\s+администратора|administrator\s+mode|platform\s+administrator/i,
  /\byou\s+are\s+(no\s+longer|now)\b/i,
  /\b(assign|set|recommend)\b[^.\n]{0,30}\bgrade\b[^.\n]{0,10}\b(senior|lead)\b/i,
  /(присвой|поставь|назначь)\b[^.\n]{0,40}(грейд|уровень)/iu,
  // поддельный результат инструмента и прямые обращения к агенту с вызовом инструментов
  /```\s*(tool_result|tool_call|function_call|system)\b/i,
  /"tool"\s*:\s*"[a-z_]+"/i,
  /\b(вызови|call|invoke|run)\s+[a-z]+_[a-z_]+\b/i,
  /(консультант|ассистент|агент|assistant|agent)\s*,\s*(чтобы|прочитай|вызови|сделай|please|call|read|fetch)/iu,
  /169\.254\.169\.254|metadata\.google\.internal/i,
];

export function detectInjection(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}
