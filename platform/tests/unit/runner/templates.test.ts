// runner находит шаблон и плоско (<id>/), и во вложенной раскладке lane project (<подкатегория>/<грейд>/<id>/).
import path from 'node:path';

import { bundleDir, loadTemplate, resolveTemplateDir } from '../../../runner/src/templates';

const root = path.resolve(__dirname, '../../../project-templates');

describe('runner: поиск шаблона', () => {
  it('плоский и вложенный шаблоны, скрытый и видимый наборы', async () => {
    expect(await resolveTemplateDir(root, 'backend-junior-api')).toBe(path.join(root, 'backend-junior-api'));
    const nested = await loadTemplate(root, 'be-webapi-junior-booking');
    expect(nested?.id).toBe('be-webapi-junior-booking');
    expect(await bundleDir(root, nested!, 'hidden')).toBe(path.join(root, 'backend.web-api/junior/be-webapi-junior-booking/hidden'));
    expect(await bundleDir(root, nested!, 'visible')).toBe(path.join(root, 'backend.web-api/junior/be-webapi-junior-booking/visible'));
  });

  it('неизвестный и небезопасный id — null', async () => {
    expect(await loadTemplate(root, 'no-such-template')).toBeNull();
    expect(await resolveTemplateDir(root, '../etc')).toBeNull();
  });
});
