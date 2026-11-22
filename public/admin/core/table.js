// Bảng dữ liệu thuần: sắp xếp và phân trang trong bộ nhớ, trả chuỗi HTML.
import { html, raw, esc } from './ui.js';

export function dataTable({ columns, rows, pageSize = 20, sort, emptyText = 'Không có dữ liệu.' }) {
  const state = {
    page: 1,
    pageSize,
    sort: sort ? { ...sort } : null,
    source: rows,
    get rows() {
      const list = [...this.source];
      if (!this.sort) return list;
      const { key, dir } = this.sort;
      const sign = dir === 'desc' ? -1 : 1;
      return list.sort((a, b) => {
        const x = a[key];
        const y = b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
        return String(x).localeCompare(String(y), 'vi') * sign;
      });
    },
    get pages() { return Math.max(1, Math.ceil(this.source.length / this.pageSize)); },
    get pageRows() {
      const page = Math.min(Math.max(1, this.page), this.pages);
      return this.rows.slice((page - 1) * this.pageSize, page * this.pageSize);
    },
  };

  function render() {
    if (!state.source.length) {
      return html`<div style="padding:24px;text-align:center;color:var(--t3)">${emptyText}</div>`;
    }
    const head = columns.map((c) => {
      if (!c.sort) return html`<th>${c.label}</th>`;
      const active = state.sort && state.sort.key === c.key;
      const arrow = active ? (state.sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return html`<th><button type="button" class="bt" data-act="sort" data-key="${c.key}">${c.label}${arrow}</button></th>`;
    }).join('');
    const body = state.pageRows.map((row) => '<tr>' + columns.map((c) => {
      // render() trả chuỗi HTML do tag `html` sinh; giá trị mặc định thì escape.
      const cell = c.render ? c.render(row) : esc(row[c.key]);
      return `<td>${cell}</td>`;
    }).join('') + '</tr>').join('');
    const page = Math.min(Math.max(1, state.page), state.pages);
    let pager = '';
    if (state.pages > 1) {
      const buttons = Array.from({ length: state.pages }, (_, i) => i + 1).map((n) => html`<button type="button" class="bt${n === page ? ' bt-p' : ''}" data-act="page" data-page="${n}"${raw(n === page ? ' aria-current="page"' : '')}>${n}</button>`).join('');
      pager = `<nav aria-label="Phân trang" style="display:flex;gap:6px;justify-content:flex-end;padding:8px">${buttons}</nav>`;
    }
    return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${pager}`;
  }

  return { html: render, state };
}
