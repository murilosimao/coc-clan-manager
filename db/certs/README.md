# Supabase CA

`supabase-prod-ca-2021.crt` é um certificado público, obtido pela URL HTTPS usada pelo Supabase Studio:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

O mesmo certificado está incluído em `src/cwl/supabase-ca.js` para o runtime serverless, sem acesso a arquivos em disco. Ele permite validar certificado e hostname tanto da conexão direta quanto do pooler do Supabase. Nunca se desativa `rejectUnauthorized` para contornar um erro de certificado.

Referências: [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) e [configuração do cliente](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).
