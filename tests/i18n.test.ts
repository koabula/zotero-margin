import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, getLanguage, setLanguage, resolveLocale, languagePreference, t, translateKnown } from '../src/i18n';
import { zhCN } from '../src/locales/zh-CN';
import { enUS } from '../src/locales/en-US';

test('language selection follows Zotero and falls back to English without changing the preference',()=>{
  assert.equal(resolveLocale('auto','zh-TW'),'zh-CN');assert.equal(resolveLocale('auto','de-DE'),'en-US');
  assert.equal(resolveLocale('en-US','zh-CN'),'en-US');assert.equal(languagePreference('invalid'),'auto');
  setLanguage('auto','en-GB');assert.equal(getLocale(),'en-US');assert.equal(getLanguage(),'auto');
});
test('catalogs cover the same messages and interpolation parameters',()=>{
  assert.deepEqual(Object.keys(enUS).sort(),Object.keys(zhCN).sort());
  for(const key of Object.keys(zhCN) as (keyof typeof zhCN)[]){
    assert.ok(enUS[key].trim());
    assert.deepEqual([...enUS[key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),[...zhCN[key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),key);
  }
  setLanguage('zh-CN');const status=t('获取到 {count} 个模型，请勾选需要的模型。',{count:3});
  setLanguage('en-US');assert.equal(translateKnown(status),'Found 3 models. Select the models you want to use.');
});
