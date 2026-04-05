import csv

ids = set()
with open('cms_cache/basic_drugs_formulary.txt', encoding='latin-1') as f:
    reader = csv.DictReader(f, delimiter='|')
    for i, row in enumerate(reader):
        ids.add(row.get('FORMULARY_ID', '').strip())
        if i >= 10000:
            break
print('Formulary IDs sample:', list(ids)[:5])

plan_ids = set()
contract_names = set()
with open('cms_cache/plan_information.txt', encoding='latin-1') as f:
    reader = csv.DictReader(f, delimiter='|')
    for row in reader:
        plan_ids.add(row.get('FORMULARY_ID', '').strip())
        contract_names.add(row.get('CONTRACT_NAME', '').strip())
print('Plan IDs sample:', list(plan_ids)[:5])
print('Overlap:', len(ids & plan_ids))
print('Sample contract names:', list(contract_names)[:10])
