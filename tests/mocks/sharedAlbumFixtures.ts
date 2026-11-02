/** Builders for Google Photos shared-album page/RPC shapes (as read by the web viewer). */

export function shareHtml(albumKey: string, authKey: string, title: string): string {
  return `<!doctype html><html><head><title>${title} - Google Photos</title></head><body>
<script>window.WIZ_global_data={};</script>
<script>AF_initDataCallback({key: 'ds:0', hash: '1', data:[]});</script>
<script>var x = {id:"snAcKc",ext: 1.0,request:["${albumKey}",null,null,"${authKey}"]};</script>
</body></html>`;
}

export function rawItem(id: string, url: string, w: number, h: number, video = false): unknown[] {
  const item: unknown[] = [id, [url, w, h, null, null, null, null, null, [123456]], 1700000000000, 'k', 0, 1700000100000];
  if (video) item.push({ '76647426': [12000] });
  return item;
}

export function batchResponse(items: unknown[], nextToken: string | null): string {
  const inner = JSON.stringify([null, items, nextToken ?? '']);
  const chunk = JSON.stringify([['wrb.fr', 'snAcKc', inner, null, null, null, 'generic'], ['di', 42]]);
  return `)]}'\n\n${chunk.length}\n${chunk}\n25\n[["e",4,null,null,123]]\n`;
}
