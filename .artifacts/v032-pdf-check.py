import json
from pathlib import Path
import pdfplumber
results = []
for name in ('cotizacion', 'entrega'):
    target = Path('.artifacts') / f'v032-{name}.pdf'
    with pdfplumber.open(target) as pdf:
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        assert len(pdf.pages) == 1
        assert abs(pdf.pages[0].width - 612) < 1
        assert abs(pdf.pages[0].height - 792) < 1
        assert 'NO ES CFDI' in text
        assert 'NO_PUBLICAR' not in text
        assert 'Propuesta portal' in text if name == 'cotizacion' else 'V03 Pieza de prueba' in text
        target.with_suffix('.txt').write_text(text, encoding='utf8')
        results.append({'tipo': name, 'pages': len(pdf.pages), 'passed': True})
Path('.artifacts/v032-pdf-check.json').write_text(json.dumps({'passed': True, 'results': results}, indent=2), encoding='utf8')
print('Dos PDF: texto/privacidad/formato carta correctos; PNG revisados por separado.')
