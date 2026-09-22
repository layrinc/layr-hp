// A project entry filters the shared document list without changing its scope or settings.
export function growthNavigation(search = '', hash = '') {
  const type = new URLSearchParams(search).get('type');
  const documentType = ['city', 'article'].includes(type) ? type : '';
  const requestedTab = hash.replace(/^#/, '');
  const tab = ['overview', 'documents', 'leads', 'health'].includes(requestedTab)
    ? requestedTab : documentType ? 'documents' : 'overview';
  return {documentType, tab};
}
