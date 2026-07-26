#!/usr/bin/env python3
import sqlite3,json,csv
from pathlib import Path
from collections import Counter,defaultdict
OUT=Path('/mnt/data/typewords_lexicon_v2');DB=OUT/'lexicon.sqlite'
con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
# normalized URL display forms should be human readable
con.execute("update lexical_units set display_form=canonical_form where normalization_flags_json like '%url_decoded_source%' and case_profile='normal'")
con.commit()
# source maps
source_ids=defaultdict(list);source_names=defaultdict(list)
for r in con.execute('''select m.lexical_unit_id,m.source_book_id,s.filename from memberships m join source_books s on s.source_book_id=m.source_book_id group by m.lexical_unit_id,m.source_book_id order by m.lexical_unit_id,s.filename'''):
    source_ids[r[0]].append(r[1]);source_names[r[0]].append(r[2])
# regenerate readable lexical units and learning order
units=[]
for r in con.execute('select * from lexical_units'):
    d=dict(r)
    d.update({
      'lexicalUnitId':d.pop('lexical_unit_id'),'identityKey':d.pop('identity_key'),'canonicalForm':d.pop('canonical_form'),'displayForm':d.pop('display_form'),'searchKey':d.pop('search_key'),'caseProfile':d.pop('case_profile'),'sourceDisambiguator':d.pop('source_disambiguator'),'unitType':d.pop('unit_type'),'parentLexicalUnitId':d.pop('parent_lexical_unit_id'),'userTier':d.pop('user_tier'),'masteryTarget':d.pop('mastery_target'),'priorityScore':d.pop('priority_score'),'sourceBookCount':d.pop('source_book_count'),'sourceFamilyCount':d.pop('source_family_count'),'sourceCategoryCount':d.pop('source_category_count'),'evidenceVariantCount':d.pop('evidence_variant_count'),'preferredVariantId':d.pop('preferred_variant_id'),'qualityStatus':d.pop('quality_status'),'sourceCategories':json.loads(d.pop('source_categories_json')),'sourceFamilies':json.loads(d.pop('source_families_json')),'crosslinkTargets':json.loads(d.pop('crosslink_targets_json')),'normalizationFlags':json.loads(d.pop('normalization_flags_json')),'missingTranslationOccurrences':d.pop('missing_translation_occurrences'),'missingPhoneticOccurrences':d.pop('missing_phonetic_occurrences'),'rawIdCount':d.pop('raw_id_count'),'sourceBookIds':source_ids[r['lexical_unit_id']]
    })
    units.append(d)
order={'A1':0,'A2':1,'R1':2,'R2':3,'O':4,'Q':5}
units.sort(key=lambda x:(order[x['userTier']],-x['priorityScore'],x['identityKey']))
with open(OUT/'lexical_units.jsonl','w',encoding='utf-8') as f:
    for d in units:f.write(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
fields=['userTier','priorityScore','canonicalForm','displayForm','identityKey','unitType','caseProfile','sourceDisambiguator','sourceBookCount','sourceFamilyCount','sourceCategories','sourceFamilies','sourceBooks','qualityStatus','crosslinkTargets','normalizationFlags','lexicalUnitId']
with open(OUT/'learning_order.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
    for d in units:
        w.writerow({'userTier':d['userTier'],'priorityScore':d['priorityScore'],'canonicalForm':d['canonicalForm'],'displayForm':d['displayForm'],'identityKey':d['identityKey'],'unitType':d['unitType'],'caseProfile':d['caseProfile'],'sourceDisambiguator':d['sourceDisambiguator'] or '','sourceBookCount':d['sourceBookCount'],'sourceFamilyCount':d['sourceFamilyCount'],'sourceCategories':';'.join(d['sourceCategories']),'sourceFamilies':';'.join(d['sourceFamilies']),'sourceBooks':';'.join(source_names[d['lexicalUnitId']]),'qualityStatus':d['qualityStatus'],'crosslinkTargets':json.dumps(d['crosslinkTargets'],ensure_ascii=False,separators=(',',':')),'normalizationFlags':';'.join(d['normalizationFlags']),'lexicalUnitId':d['lexicalUnitId']})
# summary and validation queue
TC=Counter(d['userTier'] for d in units);UC=Counter(d['unitType'] for d in units);QC=Counter(d['qualityStatus'] for d in units)
SC=Counter();ind=0
for r in con.execute('''select l.user_tier,l.priority_score,l.unit_type,l.lexical_unit_id,exists(select 1 from form_links f where f.form_unit_id=l.lexical_unit_id and f.confidence='high') hf from lexical_units l'''):
    t,s,ut,uid,hf=r
    st='Q0_cleanup' if t=='Q' else ('S0_foundation_automatic' if t=='A1' and s>=650 else 'S1_core_automatic' if t=='A1' else 'S2_general_active' if t=='A2' and s>=460 else 'S3_academic_technical_active' if t=='A2' else 'S4_broad_receptive' if t=='R1' else 'S5_specialized_contextual' if t=='R2' else 'S6_on_demand')
    independent=t!='Q' and not hf and ut!='homograph_numbered_candidate'
    if independent:SC[st]+=1;ind+=1
summary={'sourceBooks':con.execute('select count(*) from source_books').fetchone()[0],'rawMemberships':con.execute('select count(*) from memberships').fetchone()[0],'lexicalUnits':len(units),'searchKeys':con.execute('select count(distinct search_key) from lexical_units').fetchone()[0],'caseSensitiveSearchKeysSplitIntoMultipleEntities':con.execute('select count(*) from (select search_key,count(*) n from lexical_units group by search_key having n>1)').fetchone()[0],'evidenceVariants':con.execute('select count(*) from evidence_variants').fetchone()[0],'tierCounts':dict(TC),'unitTypeCounts':dict(UC),'qualityStatusCounts':dict(QC),'activeSystematicUnits':TC['A1']+TC['A2'],'receptiveUnits':TC['R1']+TC['R2'],'onDemandUnits':TC['O'],'quarantineUnits':TC['Q'],'highConfidenceFormLinks':con.execute("select count(*) from form_links where confidence='high'").fetchone()[0],'mediumConfidenceFormCandidates':con.execute("select count(*) from form_links where confidence='medium'").fetchone()[0],'independentStudyUnits':ind,'stageCountsIndependent':dict(SC),'identityPolicy':'case-insensitive search key; evidence-aware case-sensitive entity split; numbered homograph candidates preserved; URL-decoded before unit classification','sourceBoundary':'source-family categories are inferred from filenames for scheduling and do not prove official provenance or independent evidence'}
json.dump(summary,open(OUT/'build_summary.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
with open(OUT/'source_books.csv','w',encoding='utf-8-sig',newline='') as f:
    rows=[dict(r) for r in con.execute('select * from source_books order by category,filename')];w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
with open(OUT/'validation_queue.csv','w',encoding='utf-8-sig',newline='') as f:
    fs=['canonicalForm','displayForm','identityKey','unitType','userTier','qualityStatus','evidenceVariantCount','crosslinkTargets','normalizationFlags','preferredVariantId','lexicalUnitId'];w=csv.DictWriter(f,fieldnames=fs);w.writeheader()
    for d in units:
        if d['qualityStatus']!='unreviewed' or d['normalizationFlags']:
            w.writerow({'canonicalForm':d['canonicalForm'],'displayForm':d['displayForm'],'identityKey':d['identityKey'],'unitType':d['unitType'],'userTier':d['userTier'],'qualityStatus':d['qualityStatus'],'evidenceVariantCount':d['evidenceVariantCount'],'crosslinkTargets':json.dumps(d['crosslinkTargets'],ensure_ascii=False,separators=(',',':')),'normalizationFlags':';'.join(d['normalizationFlags']),'preferredVariantId':d['preferredVariantId'],'lexicalUnitId':d['lexicalUnitId']})
# safe projection files grouped by stage; full sources preserved in lexiconMeta
variants={r['evidence_variant_id']:dict(r) for r in con.execute('select * from evidence_variants')}
stage_by_uid={}
with open(OUT/'learning_sequence.jsonl',encoding='utf-8') as f:
    for line in f:
        x=json.loads(line);stage_by_uid[x['lexicalUnitId']]=x['learningStage']
groups=defaultdict(list)
for d in units:
    payload=json.loads(variants[d['preferredVariantId']]['core_payload_json'])
    if d['qualityStatus']=='detail_crosslink_quarantined':payload['etymology']=[];payload['relWords']={'root':'','rels':[]}
    for k in ['trans','sentences','phrases','synos','etymology']:
        if not isinstance(payload.get(k),list):payload[k]=[]
    if not isinstance(payload.get('relWords'),dict):payload['relWords']={'root':'','rels':[]}
    rec={'id':d['lexicalUnitId'],'custom':True,'word':d['displayForm'],'phonetic0':str(payload.get('phonetic0') or ''),'phonetic1':str(payload.get('phonetic1') or ''),'trans':payload['trans'],'sentences':payload['sentences'],'phrases':payload['phrases'],'synos':payload['synos'],'relWords':payload['relWords'],'etymology':payload['etymology'],'lexiconMeta':{'identityKey':d['identityKey'],'canonicalForm':d['canonicalForm'],'userTier':d['userTier'],'learningStage':stage_by_uid.get(d['lexicalUnitId']),'masteryTarget':d['masteryTarget'],'priorityScore':d['priorityScore'],'qualityStatus':d['qualityStatus'],'sourceBookIds':d['sourceBookIds'],'sourceFamilies':d['sourceFamilies'],'sourceCategories':d['sourceCategories'],'preferredVariantId':d['preferredVariantId']}}
    groups[stage_by_uid.get(d['lexicalUnitId'],'Q0_cleanup')].append(rec)
for st,recs in groups.items():
    json.dump(recs,open(OUT/'typewords_import'/f'{st}_safe_projection.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
catalog=[]
for p in sorted((OUT/'typewords_import').glob('S*.txt')):
    catalog.append({'id':p.stem,'name':p.stem,'url':p.name,'length':sum(1 for x in open(p,encoding='utf-8') if x.strip()),'language':'en','translateLanguage':'zh-CN','source':'typewords-lexicon-v2'})
json.dump(catalog,open(OUT/'typewords_import'/'catalog.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
con.close();print(json.dumps(summary,ensure_ascii=False,indent=2))
