import { setLanguage, languagePreference } from '../src/i18n';
setLanguage(languagePreference(localStorage.getItem('margin.language')),navigator.language);
import { Sidebar } from '../src/ui';
import { emptySession, type Config, type Session, type Store } from '../src/types';
let config: Config = { baseURL: location.origin + '/v1', model: 'margin-test-model', modelIDs:['margin-test-model','margin-test-alternate'], defaultModelID:'margin-test-model', apiKey: '' };
const sessions = new Map<string, Session>();
let pageIndex = 1;
const store: Store = { getLanguage:async()=>languagePreference(localStorage.getItem("margin.language")), saveLanguage:async value=>{localStorage.setItem("margin.language",value);}, getConfig: async () => config, saveConfig: async c => { config = c; }, loadSession: async k => sessions.get(k) || emptySession(), saveSession: async (k,s) => { sessions.set(k, structuredClone(s)); } };
const sidebar = new Sidebar(document.getElementById('app')!, { store, copy: text => { void navigator.clipboard.writeText(text); }, openURL: url => window.open(url, '_blank', 'noopener,noreferrer') });
void sidebar.attach({
  context: async () => ({ attachmentID: 1, libraryID: 1, attachmentKey: 'TEST1234', title: 'A Pragmatic Introduction to Secure Multi-Party Computation', authors: 'Evans 等', pageIndex, pageLabel: String(pageIndex + 20), pageCount: 3, selection: '' }),
  readPage: async i => ({ pageIndex: i, pageLabel: String(i + 20), text: i === 2 ? 'A simulator is an algorithm that generates the ideal-world view.' : 'The view of an adversary consists of the combined views of corrupt parties. A simulator can generate an indistinguishable ideal-world view.' }),
  annotations: async () => [{id:'TESTANN',pageIndex:1,pageLabel:'21',text:'A simulator can generate an indistinguishable view.',comment:'Why a simulator?'}],
  navigate: async s => { pageIndex = s.pageIndex; document.getElementById('events')!.textContent = `预览定位：正文第 ${s.pageLabel} 页 · PDF 第 ${s.pageIndex + 1} 页`; await sidebar.refreshContext(); },
  createNote: async title => { document.getElementById('events')!.textContent = `预览已保存笔记：${title}`; return {id:1}; },
  assertActive: () => {},
});
