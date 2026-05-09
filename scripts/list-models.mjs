const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY no está en el entorno.");
  process.exit(1);
}

const apiVersions = ["v1alpha", "v1beta", "v1"];

for (const v of apiVersions) {
  console.log(`\n──── ${v} ────`);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${v}/models?key=${apiKey}&pageSize=200`
    );
    if (!res.ok) {
      console.log(`  ${res.status} ${res.statusText}`);
      continue;
    }
    const data = await res.json();
    const models = data.models ?? [];
    const live = models.filter((m) =>
      (m.supportedGenerationMethods ?? m.supportedActions ?? []).some((mm) =>
        /bidi|live/i.test(mm)
      ) || /live|bidi/i.test(m.name)
    );
    console.log(`  total models: ${models.length}`);
    if (live.length === 0) {
      console.log("  (ningún modelo Live/Bidi visible aquí)");
    } else {
      for (const m of live) {
        const methods = m.supportedGenerationMethods ?? m.supportedActions ?? [];
        console.log(`  • ${m.name}`);
        if (methods.length) console.log(`      methods: ${methods.join(", ")}`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}
