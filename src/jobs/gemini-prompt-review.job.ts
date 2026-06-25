import { initializeDatabase } from "../db/index.js";
import { sequelize } from "../db/sequelize.js";
import { buildGeminiPromptReview } from "../services/gemini-prompt-review.service.js";

try {
  await initializeDatabase();
  const data = await buildGeminiPromptReview();
  console.log(JSON.stringify({ ok: true, data }));
  await sequelize.close();
} catch (error) {
  console.error(error);
  await sequelize.close();
  process.exit(1);
}
