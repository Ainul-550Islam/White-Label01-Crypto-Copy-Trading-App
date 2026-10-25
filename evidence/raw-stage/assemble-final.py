# Responsibility: assemble a complete, verifiable source/disclosure/evidence ZIP; preserve full bodies, disclose ungreen gates and consolidate redundant artifacts only after verified readback.
from pathlib import Path
import csv
import hashlib
import io
import json
import os
import re
import tarfile
import zipfile

ROOT = Path('/home/user/White-Label01-Crypto-Copy-Trading-App')
MONO = ROOT / 'whitelabel-copytrade'
FOLDER = Path('/home/user/API-Green-Followup')
SCRATCH = MONO / 'node_modules/.cache/api-green-followup/final'
STAGE = SCRATCH / 'assembly'
FINAL = Path('/home/user/White-Label-Copy-Trading-Final.zip')
EXCLUDE = {'.git', '.arena', '.cache', '.local', '.npm', '.next', '.nuxt', '.output', '.parcel-cache', '.playwright-cli', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.svelte-kit', '.tox', '.turbo', '.venv', '.vite', '__pycache__', 'node_modules', 'dist', 'build', 'coverage', 'out', 'target'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def full_fenced_document(title, explanation, items):
    output = bytearray((f'# {title}\n\n# Responsibility: supply every listed current file body in full with exact paths and code fences; never substitute a summary or an elision.\n\n{explanation}\n\n').encode())
    records = []
    for item in items:
        data = item['data']
        text = data.decode('utf-8')
        longest = max([len(match.group(0)) for match in re.finditer(r'`+', text)] + [2])
        fence = '`' * max(3, longest + 1)
        language = {'.ts': 'typescript', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.md': 'markdown', '.csv': 'csv', '.py': 'python', '.txt': 'text', '.log': 'text', '.tsv': 'text'}.get(Path(item['path']).suffix, 'text')
        output.extend((f"## {item['title']}\n\n**Exact absolute path:** `{item['path']}`\n\n<!-- # Responsibility: retain the entire original body below without shortening. -->\n\n**Bytes:** {len(data)} · **SHA-256:** `{digest(data)}`\n\n{fence}{language}\n").encode())
        offset = len(output)
        output.extend(data)
        if not data.endswith(b'\n'):
            output.extend(b'\n')
        output.extend((f'{fence}\n\n').encode())
        records.append({'number': item.get('number'), 'absolutePath': str(item['path']), 'bytes': len(data), 'sha256': digest(data), 'bodyByteOffset': offset})
    result = bytes(output)
    for item, record in zip(items, records):
        assert result[record['bodyByteOffset']:record['bodyByteOffset'] + record['bytes']] == item['data']
    return result, records


original_folder_files = sorted(p for p in FOLDER.iterdir() if p.is_file())
rows = list(csv.DictReader((FOLDER / 'file-disclosure-inventory.csv').open()))
assert [int(row['file_number']) for row in rows] == list(range(1, 279))
assert len(rows) == 278
entries = {}
project_records = []
for base, dirs, names in os.walk(ROOT):
    dirs[:] = sorted(name for name in dirs if name not in EXCLUDE)
    for name in sorted(names):
        path = Path(base) / name
        if not path.is_file() or name in {'.netrc', '.git-credentials'} or name == '.env' or name.startswith('.env.local') or name.endswith('.tsbuildinfo'):
            continue
        data = path.read_bytes()
        member = 'project/' + str(path.relative_to(ROOT))
        assert member not in entries
        entries[member] = data
        project_records.append({'absolutePath': str(path), 'member': member, 'bytes': len(data), 'sha256': digest(data)})

manifest = json.loads((MONO / 'RELEASE_MANIFEST.json').read_text())
assert (MONO / 'RELEASE_MANIFEST.json').read_bytes() == (ROOT / 'RELEASE_MANIFEST.json').read_bytes()
for row in manifest['files']:
    data = (ROOT / row['path']).read_bytes()
    assert len(data) == row['size_bytes'] and digest(data) == row['sha256']
    assert entries['project/' + row['path']] == data
assert len(manifest['files']) == 2366
assert len(project_records) == 2368

numbered_records = []
part_records = []
for start in range(1, 279, 30):
    stop = min(start + 29, 278)
    part = (start - 1) // 30 + 1
    items = []
    for row in rows[start - 1:stop]:
        path = Path(row['absolute_path'])
        data = path.read_bytes()
        assert len(data) == int(row['byte_length']) and digest(data) == row['sha256'] == row['final_sha256']
        assert entries['project/' + str(path.relative_to(ROOT))] == data
        items.append({'number': int(row['file_number']), 'title': f"File {row['file_number']} — {row['relative_path']}", 'path': path, 'data': data})
    member = f'disclosure/numbered/part-{part:02d}-files-{start:03d}-{stop:03d}.md'
    body, records = full_fenced_document(f'Final current disclosure — Part {part} — Files {start}–{stop}', 'Current complete snapshot: API is NOT GREEN. All 278 fixed-number bodies are supplied sequentially across ten documents. All original 275 identities remain unchanged. The user authorized finishing the remainder after File 180; no numeric line N was invented. Zero-warning acceptance and the current dependency gate remain unmet. Exact current results are in README-FIRST.md and complete native evidence.', items)
    entries[member] = body
    for record in records:
        record['disclosureMember'] = member
        numbered_records.append(record)
    part_records.append({'member': member, 'firstFile': start, 'lastFile': stop, 'completeBodies': len(items), 'bytes': len(body), 'sha256': digest(body)})
assert [record['number'] for record in numbered_records] == list(range(1, 279))

entries['README-FIRST.md'] = (FOLDER / 'FINAL-README.md').read_bytes()
entries['integrity/file-disclosure-inventory.csv'] = (FOLDER / 'file-disclosure-inventory.csv').read_bytes()
entries['evidence/api-unit-results-final.json'] = (FOLDER / 'api-unit-results-final.json').read_bytes()
entries['evidence/validation-results-final.json'] = (FOLDER / 'validation-results-final.json').read_bytes()

stage_files = sorted(path for path in SCRATCH.iterdir() if path.is_file() and path.suffix in {'.json', '.log', '.txt', '.tsv', '.md', '.py'})
stage_items = []
for path in stage_files:
    data = path.read_bytes()
    entries['evidence/raw-stage/' + path.name] = data
    stage_items.append({'title': path.name, 'path': path, 'data': data})
history, history_records = full_fenced_document('Complete final validation history — actual intermediate and final outputs', 'Final complete default API run: 173 suites / 2,896 tests / one snapshot PASS, zero failed/skipped/todo. Full lint FAIL: 0 errors / 5,214 warnings. Dependency policy FAIL: seven advisories including one critical, plus 45 stale exceptions. Superseded fixture/name-comparison failures are retained as history, not falsely counted as final passes. Every stage body below is complete.', stage_items)
entries['evidence/final-validation-history.md'] = history

extras = [
    ('Current full fixed-number inventory', FOLDER / 'file-disclosure-inventory.csv'),
    ('Current complete native default Jest JSON', FOLDER / 'api-unit-results-final.json'),
    ('Current actual validation results', FOLDER / 'validation-results-final.json'),
    ('Final download README', FOLDER / 'FINAL-README.md'),
]
extra_items = [{'title': title, 'path': path, 'data': path.read_bytes()} for title, path in extras]
evidence, evidence_records = full_fenced_document('Complete current inventory/native evidence', 'The entire current lint JSON and both manifests are already supplied in numbered Files 33, 31 and 32; every body here is likewise full. No summary substitutes for the native evidence.', extra_items)
entries['disclosure/evidence-complete.md'] = evidence

prior_index = json.loads((STAGE / 'prior-archive-content-integrity.json').read_text())
entries['history/prior-complete-archives.tar.xz'] = (STAGE / 'prior-complete-archives-solid.tar.xz').read_bytes()
entries['integrity/prior-archive-content-integrity.json'] = json_bytes(prior_index)
entries['integrity/prior-archive-content-integrity.md'] = b'# Complete prior archive preservation index\n\n# Responsibility: expose every retained original member digest and original container provenance. ZIP wrappers were repacked; every full file body is retained.\n\n```json\n' + json_bytes(prior_index) + b'```\n'
current_names = {'FINAL-README.md', 'file-disclosure-inventory.csv', 'api-unit-results-final.json', 'validation-results-final.json'}
standalone_records = []
for path in original_folder_files:
    if path.suffix == '.zip' or path.name in current_names:
        continue
    data = path.read_bytes()
    member = 'history/prior-standalone/' + path.name
    entries[member] = data
    standalone_records.append({'originalPath': str(path), 'member': member, 'bytes': len(data), 'sha256': digest(data)})

verification_script = '''# Responsibility: verify the complete final ZIP's CRCs, per-entry SHA-256, all numbered fenced body ranges and every losslessly retained historical member. No network or application side effects.
import hashlib
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path

archive = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("White-Label-Copy-Trading-Final.zip")
with zipfile.ZipFile(archive) as source:
    assert source.testzip() is None, "ZIP CRC failure"
    index = json.loads(source.read("integrity/archive-entry-sha256.json"))
    expected = {row["member"] for row in index["entries"]} | {"integrity/archive-entry-sha256.json", "integrity/archive-entry-sha256.md"}
    assert len(source.namelist()) == len(set(source.namelist())) and set(source.namelist()) == expected
    for row in index["entries"]:
        body = source.read(row["member"])
        assert len(body) == row["bytes"] and hashlib.sha256(body).hexdigest() == row["sha256"], row["member"]
    disclosure = json.loads(source.read("integrity/current-disclosure-integrity.json"))
    assert [row["number"] for row in disclosure["numberedRecords"]] == list(range(1, 279))
    for row in disclosure["numberedRecords"]:
        doc = source.read(row["disclosureMember"])
        body = doc[row["bodyByteOffset"]:row["bodyByteOffset"] + row["bytes"]]
        assert hashlib.sha256(body).hexdigest() == row["sha256"], row["number"]
    historical = json.loads(source.read("integrity/prior-archive-content-integrity.json"))
    historical_by_name = {row["retainedTarMember"]: row for row in historical["records"]}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(source.read("history/prior-complete-archives.tar.xz")), mode="r:xz") as history:
        for member in history:
            if member.name in historical_by_name:
                row = historical_by_name[member.name]
                body = history.extractfile(member).read()
                assert len(body) == row["bytes"] and hashlib.sha256(body).hexdigest() == row["sha256"], member.name
                seen.add(member.name)
    assert len(seen) == len(historical_by_name)
print("PASS: all archive entries, all 278 complete numbered bodies, and all historical full file bodies match SHA-256. This verifies integrity, NOT green/readiness.")
'''
entries['VERIFY_ARCHIVE.py'] = verification_script.encode()
verification_doc, verification_records = full_fenced_document('Complete archive verification script', 'Read-only standard-library verification code. Verify ZIP integrity and lossless file bodies; this does not claim zero warnings, vulnerability-free or live readiness.', [{'title': 'VERIFY_ARCHIVE.py', 'path': FINAL.parent / 'VERIFY_ARCHIVE.py', 'data': verification_script.encode()}])
entries['disclosure/archive-verifier-complete.md'] = verification_doc

integrity = {'responsibility': 'Verify all complete current source/disclosure/native bodies; integrity is not a green/readiness claim.', 'overallResult': 'NOT GREEN', 'all278CurrentNumberedBodiesPresent': True, 'allOriginal275IdentitiesRetained': True, 'userAuthorizedAllRemainder': True, 'numericLineNWasSupplied': False, 'lastPreviouslyDeliveredBoundary': 180, 'currentProjectFiles': len(project_records), 'manifestRecordedFiles': len(manifest['files']), 'allProjectFilesByteReadbackVerified': True, 'allMarkdownBodyRangesByteVerified': True, 'allPriorArchiveMemberBodiesReadbackVerified': True, 'priorZipWrappersRepackedNotClaimedByteRetained': True, 'priorCompleteFileBodies': prior_index['retainedCompleteFileBodies'], 'numberedParts': part_records, 'numberedRecords': numbered_records, 'completeCurrentEvidenceRecords': evidence_records, 'completeStageOutputRecords': history_records, 'historicalStandaloneRecords': standalone_records, 'archiveVerifierFullCodeRecords': verification_records}
entries['integrity/current-disclosure-integrity.json'] = json_bytes(integrity)
entries['integrity/current-disclosure-integrity.md'] = b'# Complete current source/disclosure integrity\n\n# Responsibility: expose the entire native integrity record, not excerpts.\n\n```json\n' + json_bytes(integrity) + b'```\n'
project_info = {'responsibility': 'Inventory every included current source-project file body; generated dependencies/build outputs/Git internals are not source.', 'completeProjectFiles': len(project_records), 'allManifestRecordsIncludedAndVerified': True, 'projectFiles': project_records, 'nonSourceDirectoryExclusions': sorted(EXCLUDE), 'generatedSSOPrivateKeysRemovedBeforePackaging': True, 'productionCompilationAndLintScopeExcluded': False}
entries['integrity/project-file-integrity.json'] = json_bytes(project_info)
entries['integrity/project-file-integrity.md'] = b'# Complete source-project body integrity\n\n# Responsibility: expose every included source-project path and full-file digest.\n\n```json\n' + json_bytes(project_info) + b'```\n'

entry_index = {'responsibility': 'Verify every ZIP entry except this checksum index and its exact Markdown rendering; an external whole-ZIP SHA-256 additionally covers them.', 'overallResult': 'NOT GREEN', 'entries': [{'member': name, 'bytes': len(body), 'sha256': digest(body)} for name, body in sorted(entries.items())]}
entries['integrity/archive-entry-sha256.json'] = json_bytes(entry_index)
entries['integrity/archive-entry-sha256.md'] = b'# Complete archive-entry checksums\n\n# Responsibility: expose the entire per-entry checksum index; no entry body is summarized away.\n\n```json\n' + json_bytes(entry_index) + b'```\n'

with zipfile.ZipFile(FINAL, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for name, body in entries.items():
        target.writestr(name, body, compress_type=zipfile.ZIP_STORED if name.endswith('.tar.xz') else zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(FINAL) as source:
    assert source.testzip() is None
    assert len(source.namelist()) == len(set(source.namelist())) == len(entries)
    for name, body in entries.items():
        assert source.read(name) == body, name
    for row in project_records:
        assert source.read(row['member']) == Path(row['absolutePath']).read_bytes(), row['member']
    for row in numbered_records:
        doc = source.read(row['disclosureMember'])
        assert digest(doc[row['bodyByteOffset']:row['bodyByteOffset'] + row['bytes']]) == row['sha256']
    # Before any consolidation, independently check every source old archive against the retained member index.
    expected_prior = {(row['originalArchive'], row['originalMember']): row for row in prior_index['records']}
    for path in original_folder_files:
        if path.suffix != '.zip':
            continue
        container = next(row for row in prior_index['originalContainers'] if row['originalName'] == path.name)
        assert digest(path.read_bytes()) == container['originalContainerSha256']
        with zipfile.ZipFile(path) as old:
            for info in old.infolist():
                if not info.is_dir():
                    body = old.read(info.filename)
                    row = expected_prior[(path.name, info.filename)]
                    assert len(body) == row['bytes'] and digest(body) == row['sha256']
    for path in original_folder_files:
        if path.suffix == '.zip':
            continue
        member = ('README-FIRST.md' if path.name == 'FINAL-README.md' else 'integrity/file-disclosure-inventory.csv' if path.name == 'file-disclosure-inventory.csv' else 'evidence/' + path.name if path.name in {'api-unit-results-final.json', 'validation-results-final.json'} else 'history/prior-standalone/' + path.name)
        assert source.read(member) == path.read_bytes(), path

checksum = digest(FINAL.read_bytes())
checksum_line = f'{checksum}  {FINAL.name}\n'
FINAL.with_suffix('.zip.sha256').write_text(checksum_line)
(FINAL.parent / 'FINAL-DOWNLOAD-INTEGRITY.md').write_text('# Final ZIP checksum\n\n# Responsibility: provide the complete external whole-archive checksum. Per-entry/source/disclosure/historical checks are inside the ZIP. API remains NOT GREEN.\n\n```text\n' + checksum_line + '```\n')
(STAGE / 'final-assembly-result.json').write_bytes(json_bytes({'finalArchive': str(FINAL), 'bytes': FINAL.stat().st_size, 'sha256': checksum, 'uniqueEntries': len(entries), 'projectFiles': len(project_records), 'completeCurrentNumberedBodies': 278, 'completePriorHistoricalBodies': prior_index['retainedCompleteFileBodies'], 'completeStageOutputBodies': len(stage_files), 'allZipCrcAndBodyReadbackPassed': True, 'allCurrentManifestAndInventoryBodiesVerified': True, 'allOriginalArtifactContentsPreservedBeforeAnyDeletion': True, 'originalFolderPathsToConsolidate': [str(path) for path in original_folder_files]}))
print(json.dumps({'finalArchive': str(FINAL), 'bytes': FINAL.stat().st_size, 'sha256': checksum, 'uniqueEntries': len(entries), 'projectFiles': len(project_records), 'completeNumberedBodies': 278, 'completeHistoricalBodies': prior_index['retainedCompleteFileBodies'], 'fullStageBodies': len(stage_files), 'crcReadbackAndAllSourceBodyChecks': 'PASS', 'overallAPIStatus': 'NOT GREEN'}, indent=2))
