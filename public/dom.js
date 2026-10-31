// Tiny DOM helpers shared by the applicant and staff pages.

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
