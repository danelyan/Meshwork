// Узкие объявления для тестов: у jsdom нет @types, а dom-accessibility-api не разрешается через "exports".
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    window: { document: Document };
  }
}
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(element: Element): string;
}
