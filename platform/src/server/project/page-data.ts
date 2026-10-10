// Данные блока «Проектное задание» для серверной страницы потребности (lane project).
import { loadCatalog } from '../recommend/evidence';

import { getEmployerTask, listTemplateViews, type EmployerTaskView, type TemplateView } from './service';

export async function projectBlockData(
  companyId: string,
  vacancy: { id: string; specialization: string; needs: { catalogId: string }[] },
): Promise<{ task: EmployerTaskView | null; templates: TemplateView[]; criteriaOptions: { id: string; statement: string }[] }> {
  const [task, catalog] = await Promise.all([getEmployerTask(companyId, vacancy.id), loadCatalog()]);
  // Шаблоны своего направления первыми; остальные — для смежных задач (ai, engineering).
  const templates = listTemplateViews().sort((a, b) => Number(b.specialization === vacancy.specialization) - Number(a.specialization === vacancy.specialization));
  const ids = new Set<string>([...vacancy.needs.map((n) => n.catalogId), ...templates.filter((t) => t.specialization === vacancy.specialization).flatMap((t) => t.catalogIds), ...(task?.requiredCatalogIds ?? [])]);
  const criteriaOptions = [...ids].filter((id) => catalog.has(id)).map((id) => ({ id, statement: catalog.get(id)!.statement }));
  return { task, templates, criteriaOptions };
}
