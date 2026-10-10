import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const schemas = spec.components?.schemas ?? {};

const SECTION_ORDER = [
  'Public',
  'Health',
  'Admin / Auth',
  'Admin / Admins',
  'Admin / Media',
  'Admin / Categories',
  'Admin / Wallpapers',
  'Admin / Banners',
  'Admin / Home Sections',
  'Admin / Settings',
  'Admin / Analytics',
  'Admin / Dashboard',
  'Admin / Audit Logs',
];

const SECTION_INTRO = {
  Public:
    'تطبيق الموبايل. بدون تسجيل دخول. القراءة فقط ما عدا إرسال الأحداث. لا تُرجَع خلفيات أو تصنيفات غير منشورة.',
  Health: 'فحص أن السيرفر وقاعدة البيانات شغّالان.',
  'Admin / Auth':
    'تسجيل دخول لوحة الإدارة. التوكن القصير يُرسل في الهيدر، وتوكن التجديد يبقى كوكي HttpOnly. التحديث وتسجيل الخروج يحتاجان ترويسة X-CSRF-Token.',
  'Admin / Admins': 'إدارة حسابات الأدمن. SUPER_ADMIN فقط.',
  'Admin / Media': 'رفع الصور. الحقل multipart اسمه file (أو files للرفع المتعدد). JPEG / PNG / WebP.',
  'Admin / Categories': 'تصنيفات لوحة الإدارة، بما فيها الغلاف والترتيب.',
  'Admin / Wallpapers': 'إنشاء وتعديل ونشر الخلفيات، والعمليات الجماعية.',
  'Admin / Banners': 'بانرات الصفحة الرئيسية: صورة، إجراء، تفعيل، وجدول زمني.',
  'Admin / Home Sections': 'أقسام الصفحة الرئيسية وترتيبها. configuration تختلف حسب نوع القسم.',
  'Admin / Settings': 'إعدادات التطبيق عن بُعد. القراءة للأدمن، والتعديل لـ SUPER_ADMIN مع expectedVersion.',
  'Admin / Analytics': 'تقارير المشاهدات والتنزيلات. التواريخ UTC بصيغة YYYY-MM-DD.',
  'Admin / Dashboard': 'ملخص لوحة التحكم. recent-activity لـ SUPER_ADMIN فقط.',
  'Admin / Audit Logs': 'سجل العمليات الإدارية. SUPER_ADMIN فقط.',
};

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolve(schema, depth = 0) {
  if (!schema || depth > 8) return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return resolve(schemas[name], depth + 1);
  }
  if (schema.allOf) {
    return schema.allOf.reduce((acc, part) => {
      const r = resolve(part, depth + 1);
      return { ...acc, ...r, properties: { ...(acc.properties ?? {}), ...(r?.properties ?? {}) } };
    }, {});
  }
  return schema;
}

function exampleFromSchema(schema, depth = 0) {
  const s = resolve(schema);
  if (!s || depth > 6) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined && s.type !== 'object') return s.default;
  if (s.enum) return s.enum[0];
  if (s.type === 'array') return [exampleFromSchema(s.items, depth + 1)].filter((v) => v !== null);
  if (s.type === 'object' || s.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(s.properties ?? {})) {
      const value = exampleFromSchema(prop, depth + 1);
      if (value !== null && value !== undefined) out[key] = value;
    }
    return out;
  }
  if (s.format === 'uuid') return '01928c1e-0000-7000-8000-000000000001';
  if (s.format === 'date-time') return '2026-01-01T00:00:00.000Z';
  if (s.format === 'binary') return '<file>';
  if (s.type === 'string') return '';
  if (s.type === 'boolean') return false;
  if (s.type === 'integer' || s.type === 'number') return 0;
  return null;
}

function json(value) {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

function requestExamples(op) {
  const content = op.requestBody?.content ?? {};
  const blocks = [];
  for (const [type, body] of Object.entries(content)) {
    if (body.examples) {
      for (const [name, ex] of Object.entries(body.examples)) {
        blocks.push(`**${type}** — ${name}\n\n${json(ex.value)}`);
      }
    } else if (body.example !== undefined) {
      blocks.push(`**${type}**\n\n${json(body.example)}`);
    } else if (body.schema?.example !== undefined) {
      blocks.push(`**${type}**\n\n${json(body.schema.example)}`);
    } else if (body.schema) {
      const built = exampleFromSchema(body.schema);
      if (built && Object.keys(built).length) blocks.push(`**${type}**\n\n${json(built)}`);
      else if (type.includes('multipart')) {
        const props = resolve(body.schema)?.properties ?? {};
        const lines = Object.entries(props).map(([k, v]) => `- \`${k}\`${v.description ? `: ${v.description}` : ''}`);
        blocks.push(`**${type}**\n\n${lines.join('\n')}`);
      }
    }
  }
  return blocks.join('\n\n');
}

function responseExample(res) {
  const content = res.content?.['application/json'];
  const example =
    content?.examples && Object.values(content.examples)[0]?.value !== undefined
      ? Object.values(content.examples)[0].value
      : content?.example !== undefined
        ? content.example
        : content?.schema?.example !== undefined
          ? content.schema.example
          : res.schema?.example;
  if (example !== undefined) return json(example);
  if (content?.schema) {
    const built = exampleFromSchema(content.schema);
    if (built && (typeof built !== 'object' || Object.keys(built).length)) return json({ data: built });
  }
  return '';
}

function paramLine(p) {
  const s = p.schema ?? {};
  const bits = [
    `\`${p.name}\``,
    p.in,
    p.required ? 'مطلوب' : 'اختياري',
    s.type,
    s.enum ? `أحد: ${s.enum.join(' | ')}` : '',
    s.default !== undefined ? `افتراضي: ${JSON.stringify(s.default)}` : '',
    s.minimum !== undefined ? `أدنى: ${s.minimum}` : '',
    s.maximum !== undefined ? `أقصى: ${s.maximum}` : '',
    p.description || s.description || '',
  ].filter(Boolean);
  return `- ${bits.join(' — ')}`;
}

const byTag = new Map();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = item[method];
    if (!op) continue;
    const tag = op.tags?.[0] ?? 'Other';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push({ method: method.toUpperCase(), path, op });
  }
}

const lines = [];
lines.push('# Wallpaper CMS API — مرجع الفرونت');
lines.push('');
lines.push('ملف واحد مأخوذ من Swagger الحي (`/api/docs`). كل قسم فيه كل عملياته: المسار، الصلاحية، البارامترات، مثال الطلب، ومثال الرد.');
lines.push('');
lines.push('## قبل ما تبلش');
lines.push('');
lines.push('- العنوان المحلي: `http://localhost:3000`');
lines.push('- كل المسارات تحت `/api/v1`.');
lines.push('- الرد الناجح دائماً `{ "data": ... }`. القوائم المرقمة تضيف `meta`: `{ page, limit, total, totalPages }`.');
lines.push('- الخطأ: `{ statusCode, error, message, details?, path, timestamp, requestId }`.');
lines.push('- لوحة الإدارة: بعد `POST /admin/auth/login` خذ `data.accessToken` وأرسله في كل طلب إداري: `Authorization: Bearer <accessToken>`.');
lines.push('- `refresh_token` كوكي HttpOnly على المسار `/api/v1/admin/auth`. التحديث وتسجيل الخروج يرسلان `X-CSRF-Token` بنفس قيمة `csrfToken`، مع `credentials: include`.');
lines.push('- مسارات `/public` لا تحتاج توكن.');
lines.push('- الأدوار: `EDITOR` يدير المحتوى. `SUPER_ADMIN` يدير الأدمن والإعدادات وسجل التدقيق والتنظيف.');
lines.push('');
lines.push('## الأقسام');
lines.push('');
for (const tag of SECTION_ORDER) {
  if (!byTag.has(tag)) continue;
  lines.push(`- [${tag}](#${slug(tag)}) — ${byTag.get(tag).length} عملية`);
}
lines.push('');

for (const tag of SECTION_ORDER) {
  const ops = byTag.get(tag);
  if (!ops) continue;
  lines.push(`## ${tag}`);
  lines.push('');
  if (SECTION_INTRO[tag]) {
    lines.push(SECTION_INTRO[tag]);
    lines.push('');
  }
  for (const { method, path, op } of ops) {
    const auth = op.security?.some((s) => 'admin-jwt' in s) ? 'Bearer token' : 'بدون توكن';
    lines.push(`### ${method} \`${path}\``);
    lines.push('');
    lines.push(`**${op.summary || op.operationId}**`);
    lines.push('');
    if (op.description) {
      lines.push(op.description);
      lines.push('');
    }
    lines.push(`- الصلاحية: ${auth}`);
    const roleNote = [op.summary, op.description].filter(Boolean).join(' ');
    if (roleNote.includes('SUPER_ADMIN')) lines.push('- الدور: SUPER_ADMIN');
    lines.push('');
    const params = op.parameters ?? [];
    if (params.length) {
      lines.push('**البارامترات**');
      lines.push('');
      for (const p of params) lines.push(paramLine(p));
      lines.push('');
    }
    const req = requestExamples(op);
    if (req) {
      lines.push('**الطلب**');
      lines.push('');
      lines.push(req);
      lines.push('');
    }
    const responses = Object.entries(op.responses ?? {}).sort(([a], [b]) => Number(a) - Number(b));
    if (responses.length) {
      lines.push('**الردود**');
      lines.push('');
      for (const [status, res] of responses) {
        lines.push(`- **${status}**${res.description ? ` — ${res.description}` : ''}`);
        const body = status.startsWith('2') ? responseExample(res) : '';
        if (body) {
          lines.push('');
          lines.push(body);
          lines.push('');
        }
      }
      lines.push('');
    }
  }
}

writeFileSync(process.argv[3], lines.join('\n'), 'utf8');
console.log(`operations ${[...byTag.values()].reduce((n, a) => n + a.length, 0)} bytes ${Buffer.byteLength(lines.join('\n'))}`);
