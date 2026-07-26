#!/usr/bin/env python3
from __future__ import annotations
import sqlite3,json,csv,re,hashlib,unicodedata
from collections import defaultdict,Counter
from pathlib import Path
from urllib.parse import unquote
SRC=Path('/mnt/data/typewords_lexicon_v1/lexicon.sqlite');OUT=Path('/mnt/data/typewords_lexicon_v2');DB=OUT/'lexicon.sqlite'
OUT.mkdir(parents=True,exist_ok=True);(OUT/'typewords_import').mkdir(exist_ok=True)
def jd(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def hs(x,n=18):
 if not isinstance(x,(str,bytes)):x=jd(x)
 if isinstance(x,str):x=x.encode()
 return hashlib.sha256(x).hexdigest()[:n]
def normalize_raw(s):
 raw=unicodedata.normalize('NFKC',str(s or '')).strip();dec=re.sub(r'\s+',' ',unquote(raw)).strip();return raw,dec,dec.casefold()
def acronym(s):
 letters=''.join(c for c in s if c.isalpha());return 2<=len(letters)<=12 and letters.upper()==letters and letters.lower()!=letters
def numbered(s):
 m=re.fullmatch(r"(.+?)[ _-]+([1-9]\d*)",s)
 if m and re.search('[a-z]',m.group(1)) and not re.search(r'\d',m.group(1)):return m.group(1).strip(),m.group(2)
def utype(canonical,profile,dis):
 if dis:return 'homograph_numbered_candidate'
 toks=canonical.split()
 if len(toks)>=6 or re.search(r'[.!?;:]$',canonical):return 'sentence_or_long_phrase'
 if len(toks)>=2:return 'multiword_expression'
 if re.search(r'\d',canonical):return 'digit_or_bundle_candidate'
 if re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*",canonical):return 'abbreviation_candidate' if profile=='acronym' else 'lexeme_candidate'
 return 'artifact_candidate'
def priority(ut,cats,fams,books,cross,personal=True):
 c=Counter(cats);general=c['general_core']+c['frequency_core']+c['frequency_pos'];exp=c['general_expansion']+c['cefr_course'];school=c['school_primary']+c['school_junior']+c['school_high'];basic=c['domestic_exam'];intl=c['international_exam']+c['business_exam'];adv=c['advanced_exam'];course=c['general_course'];domain=c['domain_it'];fc=len(fams);bc=len(books);cc=len(set(cats))
 if ut in {'artifact_candidate','sentence_or_long_phrase','digit_or_bundle_candidate'}:return 'Q','quarantine_before_learning',0
 if ut=='homograph_numbered_candidate':return 'R2','merge_into_base_sense_after_review',180
 if (general>=2 and fc>=2) or (general>=1 and school>=2) or (general>=1 and fc>=4) or (bc>=18 and fc>=6 and cc>=3):t,m,b='A1','active_automatic',500
 elif general>=1 or exp>=1 or (school>=2 and basic>=1) or (fc>=5 and cc>=3):t,m,b='A2','active_controlled',400
 elif (intl>=1 and fc>=2) or (adv>=1 and fc>=2) or (basic>=1 and fc>=2) or bc>=3 or course>=2:t,m,b='R1','receptive_fluent',300
 elif fc>=2 or intl or adv or domain or course:t,m,b='R2','receptive_contextual',200
 else:t,m,b='O','on_demand',100
 if personal and domain:
  if t in {'O','R2'}:t,m,b='R1','receptive_fluent',320
  elif t=='R1':t,m,b='A2','active_controlled',420
 score=b+min(bc,30)*2+min(fc,12)*5+min(cc,8)*4+min(general,5)*8+min(school,8)*2-(5 if ut=='multiword_expression' else 0)-(3 if cross else 0)
 return t,m,score

src=sqlite3.connect(SRC);src.row_factory=sqlite3.Row
if DB.exists():DB.unlink()
out=sqlite3.connect(DB);out.execute('pragma journal_mode=off');out.execute('pragma synchronous=off');out.execute('pragma temp_store=memory')
out.executescript('''
create table source_books(source_book_id text primary key,filename text unique,display_name text,category text,source_family_id text,level text,role text,records integer,within_book_duplicate_rows integer);
create table lexical_units(lexical_unit_id text primary key,identity_key text unique,language text,canonical_form text,display_form text,search_key text,case_profile text,source_disambiguator text,unit_type text,parent_lexical_unit_id text,user_tier text,mastery_target text,priority_score integer,source_book_count integer,source_family_count integer,source_category_count integer,evidence_variant_count integer,preferred_variant_id text,quality_status text,source_categories_json text,source_families_json text,crosslink_targets_json text,normalization_flags_json text,missing_translation_occurrences integer,missing_phonetic_occurrences integer,raw_id_count integer);
create table evidence_variants(evidence_variant_id text primary key,lexical_unit_id text,payload_hash text,quality_score integer,crosslink_target text,occurrences integer,source_book_count integer,source_family_count integer,core_payload_json text);
create table memberships(source_book_id text,source_index integer,source_original_id text,original_headword text,decoded_headword text,search_key text,lexical_unit_id text,evidence_variant_id text,raw_payload_hash text,primary key(source_book_id,source_index));
create index idx_mem_unit on memberships(lexical_unit_id);create index idx_unit_search on lexical_units(search_key);create index idx_unit_tier on lexical_units(user_tier,priority_score desc);create index idx_var_unit on evidence_variants(lexical_unit_id);
''')
# copy books
books={}
for r in src.execute('select * from source_books'):
 d=dict(r);books[d['source_book_id']]=d;out.execute('insert into source_books values(?,?,?,?,?,?,?,?,?)',tuple(d.values()))
# old variants lookup
oldvar={r['evidence_variant_id']:dict(r) for r in src.execute('select * from evidence_variants')}
# memberships grouped by old unit; only 277k rows, memory acceptable
mem_by=defaultdict(list)
for r in src.execute('select * from memberships order by lexical_unit_id,source_book_id,source_index'):mem_by[r['lexical_unit_id']].append(dict(r))
oldunits={r['lexical_unit_id']:dict(r) for r in src.execute('select * from lexical_units')}
newunits={};newvars={};newmembers=[];split_keys=0
for olduid,ms in mem_by.items():
 old=oldunits[olduid];base=old['canonical_form']
 num=numbered(base)
 if num:
  clusters=[('normal',ms,num[0],num[1],num[0]+'#sense:'+num[1])]
 else:
  prof=defaultdict(list);vsets=defaultdict(set)
  for m in ms:
   _,dec,_=normalize_raw(m['original_headword']);p='acronym' if acronym(dec) else 'normal';prof[p].append(m);vsets[p].add(m['evidence_variant_id'])
  if len(prof)>1 and not (vsets['acronym'] & vsets['normal']):
   clusters=[('normal',prof['normal'],base,None,base),('acronym',prof['acronym'],base,None,base+'#case:upper')];split_keys+=1
  else:
   allms=sum(prof.values(),[]);p='acronym' if set(prof)=={'acronym'} else 'normal';clusters=[(p,allms,base,None,base)]
 for profile,cms,canonical,dis,ikey in clusters:
  uid='lu:'+hs('en\0'+ikey,18);surface=Counter(m['original_headword'] for m in cms).most_common(1)[0][0];ut=utype(canonical,profile,dis)
  sb={m['source_book_id'] for m in cms};fams={books[x]['source_family_id'] for x in sb};cats={books[x]['category'] for x in sb};rawids={str(m['source_original_id']) for m in cms if m['source_original_id'] is not None};flags=set()
  for m in cms:
   raw,dec,_=normalize_raw(m['original_headword'])
   if '%' in raw and dec!=raw:flags.add('url_decoded_source')
  cross=Counter();variant_ids=set();missT=0;missP=0
  # create unit-specific evidence variants
  for m in cms:
   ov=oldvar[m['evidence_variant_id']];payload=json.loads(ov['core_payload_json']);ph=ov['payload_hash'];vid='ev:'+hs(uid+'\0'+ph,20);variant_ids.add(vid)
   if ov['crosslink_target']:cross[ov['crosslink_target']]+=1
   if not payload.get('trans'):missT+=1
   if not payload.get('phonetic0') and not payload.get('phonetic1'):missP+=1
   nv=newvars.setdefault(vid,{'evidence_variant_id':vid,'lexical_unit_id':uid,'payload_hash':ph,'quality_score':ov['quality_score'],'crosslink_target':ov['crosslink_target'],'occurrences':0,'books':set(),'fams':set(),'core_payload_json':ov['core_payload_json']})
   nv['occurrences']+=1;nv['books'].add(m['source_book_id']);nv['fams'].add(books[m['source_book_id']]['source_family_id'])
   newmembers.append((m['source_book_id'],m['source_index'],m['source_original_id'],m['original_headword'],m['decoded_headword'],canonical.casefold(),uid,vid,m['raw_payload_hash']))
  candidates=[newvars[v] for v in variant_ids];candidates.sort(key=lambda v:(v['quality_score'],len(v['fams']),v['occurrences']),reverse=True);pref=candidates[0]
  tier,mastery,score=priority(ut,cats,fams,sb,bool(cross),True)
  q='quarantined_form' if tier=='Q' else ('detail_crosslink_quarantined' if cross else ('conflicting_variants' if len(variant_ids)>1 else 'unreviewed'))
  newunits[uid]={'lexical_unit_id':uid,'identity_key':ikey,'language':'en','canonical_form':canonical,'display_form':surface,'search_key':canonical.casefold(),'case_profile':profile,'source_disambiguator':dis,'unit_type':ut,'parent_lexical_unit_id':None,'user_tier':tier,'mastery_target':mastery,'priority_score':score,'source_book_count':len(sb),'source_family_count':len(fams),'source_category_count':len(cats),'evidence_variant_count':len(variant_ids),'preferred_variant_id':pref['evidence_variant_id'],'quality_status':q,'source_categories_json':jd(sorted(cats)),'source_families_json':jd(sorted(fams)),'crosslink_targets_json':jd(dict(cross)),'normalization_flags_json':jd(sorted(flags)),'missing_translation_occurrences':missT,'missing_phonetic_occurrences':missP,'raw_id_count':len(rawids)}
# parent IDs for numbered homographs
by_identity={u['identity_key']:uid for uid,u in newunits.items()}
for u in newunits.values():
 if u['source_disambiguator']:u['parent_lexical_unit_id']=by_identity.get(u['canonical_form'])
# write DB
out.executemany('insert into memberships values(?,?,?,?,?,?,?,?,?)',newmembers)
for v in newvars.values():out.execute('insert into evidence_variants values(?,?,?,?,?,?,?,?,?)',(v['evidence_variant_id'],v['lexical_unit_id'],v['payload_hash'],v['quality_score'],v['crosslink_target'],v['occurrences'],len(v['books']),len(v['fams']),v['core_payload_json']))
cols=list(next(iter(newunits.values())).keys());out.executemany('insert into lexical_units values('+','.join('?' for _ in cols)+')',[tuple(u[c] for c in cols) for u in newunits.values()]);out.commit()
# form links and sequence
IR={'am':'be','is':'be','are':'be','was':'be','were':'be','been':'be','being':'be','has':'have','had':'have','does':'do','did':'do','done':'do','went':'go','gone':'go','came':'come','became':'become','made':'make','took':'take','taken':'take','got':'get','gotten':'get','gave':'give','given':'give','saw':'see','seen':'see','knew':'know','known':'know','thought':'think','said':'say','told':'tell','found':'find','felt':'feel','left':'leave','brought':'bring','bought':'buy','taught':'teach','caught':'catch','fought':'fight','wrote':'write','written':'write','spoke':'speak','spoken':'speak','ran':'run','swam':'swim','swum':'swim','flew':'fly','flown':'fly','drew':'draw','drawn':'draw','drove':'drive','driven':'drive','rode':'ride','ridden':'ride','ate':'eat','eaten':'eat','drank':'drink','drunk':'drink','slept':'sleep','kept':'keep','met':'meet','paid':'pay','stood':'stand','understood':'understand','wore':'wear','worn':'wear','won':'win','lost':'lose','sent':'send','built':'build','held':'hold','heard':'hear','fell':'fall','fallen':'fall','broke':'break','broken':'break','chose':'choose','chosen':'choose','forgot':'forget','forgotten':'forget','began':'begin','begun':'begin','sang':'sing','sung':'sing','rang':'ring','rung':'ring','rose':'rise','risen':'rise','lay':'lie','lain':'lie','lying':'lie','laid':'lay','led':'lead','grew':'grow','grown':'grow','threw':'throw','thrown':'throw','shown':'show','sold':'sell','sat':'sit','children':'child','mice':'mouse','feet':'foot','teeth':'tooth','geese':'goose','men':'man','women':'woman','people':'person','better':'good','best':'good','worse':'bad','worst':'bad','less':'little','least':'little','more':'much','most':'much'}
normal={u['canonical_form']:uid for uid,u in newunits.items() if u['case_profile']=='normal' and not u['source_disambiguator'] and u['unit_type']=='lexeme_candidate'}
out.execute('create table form_links(form_unit_id text,lemma_unit_id text,confidence text,relation_type text,primary key(form_unit_id,lemma_unit_id,relation_type))')
def forms(w):
 z=[]
 if w in IR and IR[w] in normal:z.append((IR[w],'high','irregular_inflection'))
 if re.fullmatch('[a-z]+',w):
  op=[]
  if w.endswith('ies') and len(w)>4:op.append((w[:-3]+'y','plural_or_3sg'))
  if w.endswith('ied') and len(w)>4:op.append((w[:-3]+'y','past_or_participle'))
  if w.endswith('ing') and len(w)>5:
   a=w[:-3];op.extend([(a,'present_participle'),(a+'e','present_participle')]);
   if len(a)>2 and a[-1]==a[-2]:op.append((a[:-1],'present_participle'))
  if w.endswith('ed') and len(w)>4:
   a=w[:-2];op.extend([(a,'past_or_participle'),(a+'e','past_or_participle')]);
   if len(a)>2 and a[-1]==a[-2]:op.append((a[:-1],'past_or_participle'))
  if w.endswith('es') and len(w)>4:op.extend([(w[:-2],'plural_or_3sg'),(w[:-1],'plural_or_3sg')])
  elif w.endswith('s') and len(w)>3 and not w.endswith(('ss','us','is')):op.append((w[:-1],'plural_or_3sg'))
  for b,t in op:
   if b in normal and b!=w and not any(x[0]==b for x in z):z.append((b,'medium',t))
 return z
def stage(u):
 t=u['user_tier'];s=u['priority_score']
 if t=='Q':return 'Q0_cleanup'
 if t=='A1':return 'S0_foundation_automatic' if s>=650 else 'S1_core_automatic'
 if t=='A2':return 'S2_general_active' if s>=460 else 'S3_academic_technical_active'
 if t=='R1':return 'S4_broad_receptive'
 if t=='R2':return 'S5_specialized_contextual'
 return 'S6_on_demand'
SO={'S0_foundation_automatic':0,'S1_core_automatic':1,'S2_general_active':2,'S3_academic_technical_active':3,'S4_broad_receptive':4,'S5_specialized_contextual':5,'S6_on_demand':6,'Q0_cleanup':7};seq=[];fc=Counter()
for u in newunits.values():
 links=forms(u['canonical_form']) if u['unit_type']=='lexeme_candidate' and u['case_profile']=='normal' and not u['source_disambiguator'] else [];primary=next((x for x in links if x[1]=='high'),None)
 for b,c,t in links:out.execute('insert or ignore into form_links values(?,?,?,?)',(u['lexical_unit_id'],normal[b],c,t));fc[c]+=1
 prereq=[]
 if u['unit_type']=='multiword_expression':
  for tok in re.findall(r"[a-z]+(?:[-'][a-z]+)*",u['canonical_form']):
   if tok in normal and normal[tok] not in prereq:prereq.append(normal[tok])
 independent=u['user_tier']!='Q' and not primary and u['unit_type']!='homograph_numbered_candidate'
 seq.append({'lexicalUnitId':u['lexical_unit_id'],'canonicalForm':u['canonical_form'],'displayForm':u['display_form'],'unitType':u['unit_type'],'learningStage':stage(u),'userTier':u['user_tier'],'masteryTarget':u['mastery_target'],'priorityScore':u['priority_score'],'independentStudy':independent,'formOfCanonical':primary[0] if primary else '','formOfLexicalUnitId':normal[primary[0]] if primary else '','formRelationType':primary[2] if primary else '','formCandidates':[{'canonicalForm':b,'lexicalUnitId':normal[b],'confidence':c,'relationType':t} for b,c,t in links],'prerequisiteLexicalUnitIds':prereq,'parentLexicalUnitId':u['parent_lexical_unit_id'],'qualityStatus':u['quality_status'],'sourceBookCount':u['source_book_count'],'sourceFamilyCount':u['source_family_count']})
out.commit();seq.sort(key=lambda x:(not x['independentStudy'],SO[x['learningStage']],-x['priorityScore'],x['canonicalForm'],x['displayForm']));rank=0
for x in seq:
 if x['independentStudy']:rank+=1;x['independentRank']=rank
 else:x['independentRank']=''
# outputs
units_sorted=sorted(newunits.values(),key=lambda u:(['A1','A2','R1','R2','O','Q'].index(u['user_tier']),-u['priority_score'],u['identity_key']))
with open(OUT/'lexical_units.jsonl','w',encoding='utf-8') as f:
 for u in units_sorted:f.write(jd(u)+'\n')
with open(OUT/'evidence_variants.jsonl','w',encoding='utf-8') as f:
 for v in sorted(newvars.values(),key=lambda z:z['evidence_variant_id']):f.write(jd({**v,'books':sorted(v['books']),'fams':sorted(v['fams'])})+'\n')
# source books
json.dump(list(books.values()),open(OUT/'source_books.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
with open(OUT/'memberships.jsonl','w',encoding='utf-8') as f:
 for r in out.execute('select m.*,s.filename from memberships m join source_books s on s.source_book_id=m.source_book_id order by m.source_book_id,m.source_index'):
  f.write(jd({'sourceBookId':r[0],'sourceFilename':r[9],'sourceIndex':r[1],'sourceOriginalId':r[2],'originalHeadword':r[3],'decodedHeadword':r[4],'searchKey':r[5],'lexicalUnitId':r[6],'evidenceVariantId':r[7],'rawPayloadHash':r[8]})+'\n')
fields=['independentRank','learningStage','userTier','masteryTarget','priorityScore','canonicalForm','displayForm','unitType','independentStudy','formOfCanonical','formRelationType','parentLexicalUnitId','sourceBookCount','sourceFamilyCount','qualityStatus','lexicalUnitId','prerequisiteLexicalUnitIds','formCandidates']
with open(OUT/'learning_sequence.csv','w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for x in seq:
  r={k:x.get(k,'') for k in fields};r['prerequisiteLexicalUnitIds']=';'.join(x['prerequisiteLexicalUnitIds']);r['formCandidates']=jd(x['formCandidates']);w.writerow(r)
with open(OUT/'learning_sequence.jsonl','w',encoding='utf-8') as f:
 for x in seq:f.write(jd(x)+'\n')
# provenance by unit
with open(OUT/'sources_by_unit.jsonl','w',encoding='utf-8') as f:
 cur=None;arr=[];meta=None
 q='''select m.lexical_unit_id,l.identity_key,l.canonical_form,l.display_form,m.source_book_id,s.filename,m.source_index,m.source_original_id,m.original_headword,m.evidence_variant_id from memberships m join lexical_units l on l.lexical_unit_id=m.lexical_unit_id join source_books s on s.source_book_id=m.source_book_id order by m.lexical_unit_id,m.source_book_id,m.source_index'''
 for r in out.execute(q):
  if cur and r[0]!=cur:f.write(jd({**meta,'sources':arr})+'\n');arr=[]
  cur=r[0];meta={'lexicalUnitId':r[0],'identityKey':r[1],'canonicalForm':r[2],'displayForm':r[3]};arr.append({'sourceBookId':r[4],'filename':r[5],'sourceIndex':r[6],'sourceOriginalId':r[7],'originalHeadword':r[8],'evidenceVariantId':r[9]})
 if cur:f.write(jd({**meta,'sources':arr})+'\n')
for st in SO:
 rows=[x for x in seq if x['learningStage']==st and x['independentStudy']];(OUT/'typewords_import'/f'{st}.txt').write_text('\n'.join(x['displayForm'] for x in rows)+'\n',encoding='utf-8')
# readable learning order
idfile={k:v['filename'] for k,v in books.items()}
with open(OUT/'learning_order.csv','w',encoding='utf-8-sig',newline='') as f:
 fs=['userTier','priorityScore','canonicalForm','displayForm','identityKey','unitType','caseProfile','sourceDisambiguator','sourceBookCount','sourceFamilyCount','sourceCategories','sourceFamilies','sourceBooks','qualityStatus','crosslinkTargets','normalizationFlags','lexicalUnitId'];w=csv.DictWriter(f,fieldnames=fs);w.writeheader()
 for u in units_sorted:
  r={'userTier':u['user_tier'],'priorityScore':u['priority_score'],'canonicalForm':u['canonical_form'],'displayForm':u['display_form'],'identityKey':u['identity_key'],'unitType':u['unit_type'],'caseProfile':u['case_profile'],'sourceDisambiguator':u['source_disambiguator'] or '','sourceBookCount':u['source_book_count'],'sourceFamilyCount':u['source_family_count'],'sourceCategories':';'.join(json.loads(u['source_categories_json'])),'sourceFamilies':';'.join(json.loads(u['source_families_json'])),'sourceBooks':';'.join(idfile[x] for x in {m[0] for m in newmembers if m[6]==u['lexical_unit_id']}),'qualityStatus':u['quality_status'],'crosslinkTargets':u['crosslink_targets_json'],'normalizationFlags':';'.join(json.loads(u['normalization_flags_json'])),'lexicalUnitId':u['lexical_unit_id']};w.writerow(r)
# summary
TC=Counter(u['user_tier'] for u in newunits.values());UC=Counter(u['unit_type'] for u in newunits.values());QC=Counter(u['quality_status'] for u in newunits.values());SC=Counter(x['learningStage'] for x in seq if x['independentStudy'])
summary={'sourceBooks':len(books),'rawMemberships':len(newmembers),'lexicalUnits':len(newunits),'searchKeys':len(set(u['search_key'] for u in newunits.values())),'caseSensitiveSearchKeysSplitIntoMultipleEntities':split_keys,'evidenceVariants':len(newvars),'tierCounts':dict(TC),'unitTypeCounts':dict(UC),'qualityStatusCounts':dict(QC),'activeSystematicUnits':TC['A1']+TC['A2'],'receptiveUnits':TC['R1']+TC['R2'],'onDemandUnits':TC['O'],'quarantineUnits':TC['Q'],'highConfidenceFormLinks':fc['high'],'mediumConfidenceFormCandidates':fc['medium'],'independentStudyUnits':sum(x['independentStudy'] for x in seq),'stageCountsIndependent':dict(SC),'identityPolicy':'casefold search key; split uppercase/lowercase when evidence variants do not overlap; preserve numbered homograph candidates; URL-decode before classifying unit type'}
json.dump(summary,open(OUT/'build_summary.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False,indent=2));src.close();out.close()
