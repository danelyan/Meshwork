import { createProjectTaskDraft } from "@/server/agent/employer/tools/create_project_task_draft";
import type {
  EmployerAgentEvent,
  EmployerToolContext,
} from "@/server/agent/employer/types";

const m = vi.hoisted(() => ({
  listVacancies: vi.fn(),
  projectBlockData: vi.fn(),
}));
vi.mock("@/server/employer", () => ({ listVacancies: m.listVacancies }));
vi.mock("@/server/project/page-data", () => ({
  projectBlockData: m.projectBlockData,
}));

const tpl = (
  id: string,
  specialization: string,
  subcategoryId: string,
  grade: string,
) => ({
  id,
  title: `T ${id}`,
  summary: "",
  specialization,
  subcategoryId,
  subcategoryTitle: subcategoryId,
  grade,
  stack: [],
  timeBudgetMin: 60,
  catalogIds: [],
  tests: { visible: 1, hidden: 1 },
});
const TEMPLATES = [
  tpl("be-api-mid", "backend", "web-api", "middle"),
  tpl("be-etl-mid", "backend", "data-etl", "middle"),
  tpl("be-api-senior", "backend", "web-api", "senior"),
  tpl("fe-ui-mid", "frontend", "ui", "middle"),
];
const CRITERIA = [
  { id: "c1", statement: "REST" },
  { id: "c2", statement: "SQL" },
  { id: "c3", statement: "Docker" },
];
const vac = (o: Record<string, unknown> = {}) => ({
  id: "v1",
  title: "Backend-разработчик",
  specialization: "backend",
  grade: "middle",
  subcategoryId: null,
  archived: false,
  needs: [{ catalogId: "c1" }, { catalogId: "c2" }, { catalogId: "zzz" }],
  ...o,
});

let events: EmployerAgentEvent[];
const ctx = (): EmployerToolContext => ({
  employerProfileId: "p1",
  companyId: "co1",
  conversationId: "c",
  emit: (e) => events.push(e),
  llm: {} as EmployerToolContext["llm"],
});
const run = (input: Record<string, unknown> = {}) =>
  createProjectTaskDraft.handler(ctx(), { rationale: "потому что", ...input });
const draft = () =>
  (events[0] as Extract<EmployerAgentEvent, { type: "project_task_draft" }>)
    .draft;

beforeEach(() => {
  events = [];
  m.listVacancies.mockReset().mockResolvedValue([vac()]);
  m.projectBlockData
    .mockReset()
    .mockResolvedValue({
      task: null,
      templates: TEMPLATES,
      criteriaOptions: CRITERIA,
    });
});

describe("create_project_task_draft", () => {
  it("автоподбор: специализация × грейд (+подкатегория), критерии из требований вакансии", async () => {
    expect(await run()).toEqual({ drafted: true, ...draft() });
    expect(draft()).toMatchObject({
      vacancyId: "v1",
      templateId: "be-api-mid",
      visibility: "feed",
      replacesExisting: false,
      wishes: "",
    });
    expect(draft().criteria).toEqual([
      { catalogId: "c1", statement: "REST" },
      { catalogId: "c2", statement: "SQL" },
    ]);
    m.listVacancies.mockResolvedValue([vac({ subcategoryId: "data-etl" })]);
    events = [];
    await run();
    expect(draft().templateId).toBe("be-etl-mid");
  });

  it("нет шаблона под грейд — ошибка со списком ближайших", async () => {
    m.listVacancies.mockResolvedValue([vac({ grade: "junior" })]);
    await expect(run()).rejects.toThrow(/шаблона нет.*be-api-mid/);
    expect(events).toHaveLength(0);
  });

  it("явный шаблон другого направления или вне каталога — ошибка со списком подходящих", async () => {
    await expect(run({ templateId: "fe-ui-mid" })).rejects.toThrow(
      /не подходит.*be-api-senior/,
    );
    await expect(run({ templateId: "nope" })).rejects.toThrow(/Подходящие/);
    await run({ templateId: "be-api-senior" });
    expect(draft().templateId).toBe("be-api-senior");
  });

  it("явные критерии: проверяются по каталогу, лимит формы", async () => {
    await run({ criteriaIds: ["c3"] });
    expect(draft().criteria).toEqual([
      { catalogId: "c3", statement: "Docker" },
    ]);
    await expect(run({ criteriaIds: ["bad"] })).rejects.toThrow(
      /нет в каталоге: bad/,
    );
  });

  it("replacesExisting, пожелания и видимость", async () => {
    m.projectBlockData.mockResolvedValue({
      task: { id: "t1" },
      templates: TEMPLATES,
      criteriaOptions: CRITERIA,
    });
    await run({ wishes: " тесты обязательны ", visibility: "invited" });
    expect(draft()).toMatchObject({
      replacesExisting: true,
      wishes: "тесты обязательны",
      visibility: "invited",
    });
  });

  it("несколько активных вакансий без vacancyId — ошибка «уточни»", async () => {
    m.listVacancies.mockResolvedValue([vac(), vac({ id: "v2" })]);
    await expect(run()).rejects.toThrow(/уточни/);
    await run({ vacancyId: "v2" });
    expect(draft().vacancyId).toBe("v2");
  });
});
