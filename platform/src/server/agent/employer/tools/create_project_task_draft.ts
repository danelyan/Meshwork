import { z } from "zod";

import { errors } from "@/server/errors";

import { projectBlockData } from "@/server/project/page-data";
import { MAX_REQUIRED_CRITERIA } from "@/server/project/schemas";
import type { TemplateView } from "@/server/project/service";

import type { ProjectTaskDraft } from "../types";
import { resolveVacancy, type EmployerTool } from "./shared";

const Input = z.object({
  vacancyId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Вакансия; null — единственная активная или уточни через ask_user",
    ),
  templateId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Шаблон задания из каталога; null — подобрать по специализации, подкатегории и грейду вакансии",
    ),
  criteriaIds: z
    .array(z.string().min(1))
    .max(12)
    .optional()
    .describe(
      "Обязательные критерии из каталога утверждений (catalogId); пусто — требования вакансии",
    ),
  wishes: z
    .string()
    .max(1500)
    .optional()
    .describe(
      "Пожелания работодателя свободным текстом — станут пунктами рубрики",
    ),
  visibility: z
    .enum(["feed", "invited"])
    .optional()
    .describe("Кому видно: лента направления или только приглашённые"),
  rationale: z
    .string()
    .min(3)
    .max(300)
    .describe("Одной фразой: почему такой шаблон и критерии"),
});
const Output = z.object({
  drafted: z.literal(true),
  // Поля ProjectTaskDraft: диспетчер сохраняет результат по этой схеме, restore.ts восстанавливает карточку из него.
  vacancyId: z.string(),
  vacancyTitle: z.string(),
  templateId: z.string(),
  templateTitle: z.string(),
  criteria: z.array(z.object({ catalogId: z.string(), statement: z.string() })),
  wishes: z.string(),
  visibility: z.enum(["feed", "invited"]),
  replacesExisting: z.boolean(),
  rationale: z.string(),
});

const fmt = (t: TemplateView) =>
  `${t.id} «${t.title}» (${t.subcategoryTitle}, ${t.grade})`;

/** Автоподбор: специализация × подкатегория × грейд; без подкатегории у вакансии — любая подкатегория. Первый по порядку каталога. */
export function autoPickTemplate(
  templates: TemplateView[],
  v: { specialization: string; grade: string; subcategoryId: string | null },
): TemplateView | null {
  const same = templates.filter(
    (t) => t.specialization === v.specialization && t.grade === v.grade,
  );
  return (
    same.find((t) => !v.subcategoryId || t.subcategoryId === v.subcategoryId) ??
    null
  );
}

/** Ближайшие к вакансии: тот же грейд или та же подкатегория (своей специализации). */
export function nearestTemplates(
  templates: TemplateView[],
  v: { specialization: string; grade: string; subcategoryId: string | null },
): TemplateView[] {
  const own = templates.filter((t) => t.specialization === v.specialization);
  const near = own.filter(
    (t) =>
      t.grade === v.grade ||
      (v.subcategoryId && t.subcategoryId === v.subcategoryId),
  );
  return (near.length ? near : own).slice(0, 6);
}

/**
 * Черновик проектного задания к вакансии (ProjectTaskDraft → событие project_task_draft). Ничего не создаёт:
 * задание формирует человек кнопкой «Сформировать» (POST /api/employer/needs/:id/project).
 */
export const createProjectTaskDraft: EmployerTool = {
  name: "create_project_task_draft",
  description:
    "Собрать черновик проектного задания к вакансии: шаблон платформы (контракт и скрытые тесты фиксированы), обязательные критерии из каталога утверждений, пожелания работодателя, кому видно. Без templateId шаблон подбирается по специализации, подкатегории и грейду вакансии, без criteriaIds критерии берутся из требований вакансии. Когда работодатель просит «сделать задание», «проверить навыки проектом», «дать тестовое». Ничего не создаёт: задание формирует человек кнопкой «Сформировать» (если задание уже есть, оно будет заменено).",
  input: Input,
  output: Output,
  terminal: false,
  async handler(
    ctx,
    input: z.infer<typeof Input>,
  ): Promise<z.infer<typeof Output>> {
    const v = await resolveVacancy(ctx.companyId, input.vacancyId);
    const { task, templates, criteriaOptions } = await projectBlockData(
      ctx.companyId,
      v,
    );

    let template: TemplateView | null | undefined;
    if (input.templateId) {
      template = templates.find((t) => t.id === input.templateId);
      if (!template || template.specialization !== v.specialization) {
        const fit = templates.filter(
          (t) => t.specialization === v.specialization,
        );
        throw errors.badRequest(
          `Шаблон ${input.templateId} не подходит этой вакансии (${v.specialization}). Подходящие: ${fit.map(fmt).join("; ") || "нет шаблонов этого направления"}`,
        );
      }
    } else {
      template = autoPickTemplate(templates, v);
      if (!template) {
        const near = nearestTemplates(templates, v);
        throw errors.badRequest(
          `Для вакансии «${v.title}» (${v.specialization}, ${v.grade}) шаблона нет. Ближайшие: ${near.map(fmt).join("; ") || "в этом направлении шаблонов нет"} — предложи работодателю один из них и передай templateId`,
        );
      }
    }

    const byId = new Map(criteriaOptions.map((c) => [c.id, c.statement]));
    let ids: string[];
    if (input.criteriaIds?.length) {
      const bad = input.criteriaIds.filter((id) => !byId.has(id));
      if (bad.length)
        throw errors.badRequest(
          `Критериев нет в каталоге: ${bad.join(", ")}. Доступные: ${criteriaOptions.map((c) => `${c.id} «${c.statement}»`).join("; ")}`,
        );
      ids = [...new Set(input.criteriaIds)];
      if (ids.length > MAX_REQUIRED_CRITERIA)
        throw errors.badRequest(`Критериев не больше ${MAX_REQUIRED_CRITERIA}`);
    } else {
      ids = [...new Set(v.needs.map((n) => n.catalogId))]
        .filter((id) => byId.has(id))
        .slice(0, MAX_REQUIRED_CRITERIA);
    }

    const draft: ProjectTaskDraft = {
      vacancyId: v.id,
      vacancyTitle: v.title,
      templateId: template.id,
      templateTitle: template.title,
      criteria: ids.map((id) => ({ catalogId: id, statement: byId.get(id)! })),
      wishes: input.wishes?.trim() ?? "",
      visibility: input.visibility ?? "feed",
      replacesExisting: task !== null,
      rationale: input.rationale,
    };
    ctx.emit({ type: "project_task_draft", draft });
    return { drafted: true, ...draft };
  },
};
