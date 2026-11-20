from pathlib import Path
import os, json, time, uuid, sys

runtime = Path(os.environ['WYD_COMMAND_DIR']) if os.environ.get('WYD_COMMAND_DIR') else Path(os.environ['LOCALAPPDATA'])/'WaterYouModding/native-runtime'
command = json.loads(sys.argv[1]) if sys.argv[1].startswith('{') else json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
command['request'] = 'dev-'+uuid.uuid4().hex
temp = runtime/'dev-command.tmp'
temp.write_text(json.dumps(command, ensure_ascii=False), encoding='utf-8')
for retry in range(20):
    try:
        temp.replace(runtime/'mod-command.json')
        break
    except PermissionError:
        if retry==19: raise
        time.sleep(.05)
for _ in range(60):
    time.sleep(.1)
    try: result = json.loads((runtime/'mod-result.json').read_text(encoding='utf-8'))
    except (OSError, ValueError): continue
    if result.get('request') == command['request']:
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1 if 'error' in result else 0)
raise SystemExit('Command was not acknowledged')
