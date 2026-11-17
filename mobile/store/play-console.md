# Play Console: copy-paste answers

App: **EdgeLetter**, package `blog.edgeletter`, free, category *Productivity* (or *News & Magazines*).

## Store listing

**App name** (30 max): `EdgeLetter`

**Short description** (80 max)
- en-US: `Write, publish and send your newsletter from your phone.`
- pt-BR: `Escreva, publique e envie sua newsletter pelo celular.`

**Full description**

en-US:
```
EdgeLetter is a quiet place to write a newsletter.

Write your posts, publish them to your own site and send them to your subscribers by email, all from your phone.

• A focused editor with images, headings and links
• Your own publication site at yourname.edgeletter.blog
• Email delivery to your subscribers when you publish
• Subscriber list with import and export
• Opens and clicks for every issue
• Invite editors to write with you
• English and Portuguese

Sign in with the 6-digit code we email you. No password needed.
```

pt-BR:
```
EdgeLetter é um lugar tranquilo para escrever uma newsletter.

Escreva seus posts, publique no seu próprio site e envie por e-mail para seus inscritos, tudo pelo celular.

• Editor focado, com imagens, títulos e links
• Seu site de publicação em seunome.edgeletter.blog
• Envio por e-mail para os inscritos ao publicar
• Lista de inscritos com importação e exportação
• Aberturas e cliques de cada edição
• Convide editores para escrever com você
• Português e inglês

Entre com o código de 6 dígitos que enviamos por e-mail. Sem senha.
```

**Graphics:** `icon-512.png`, `feature-1024x500.png` (this folder). Phone screenshots: `en-1-overview.png` … `en-6-signin.png` for en-US and `pt-1-overview.png` … `pt-6-signin.png` for pt-BR (1080×1920, from the app on Android 16).

**Contact email:** hello@rubrion.ai · **Website:** https://edgeletter.blog

## App content

- **Privacy policy:** https://edgeletter.blog/privacy
- **Ads:** No ads.
- **App access:** *All or some functionality is restricted* → add instructions:
  - Email: the `REVIEW_EMAIL` value (Infisical, Edgeletter `prod:/worker/REVIEW_EMAIL`)
  - Code: the `REVIEW_CODE` value (`prod:/worker/REVIEW_CODE`)
  - Instructions: "Enter the email, tap *Email me a sign-in link*, then type the code in the *Sign-in code* field. The account already has a demo publication."
- **Content rating:** questionnaire → *Utility, productivity, communication or other*; user-generated content: yes (users publish posts); no violence, sexual content, gambling, etc.
- **Target audience:** 18+.
- **News app:** No (users publish their own content; EdgeLetter isn't a news publisher).
- **Data safety:**
  - Data collected: **Email address** (account management, app functionality), **Name** (optional, from the profile), **Other user-generated content** (posts, images; app functionality), **Other info**: subscriber emails the user imports (app functionality).
  - App activity: none tracked. No location, contacts, financial info or device IDs.
  - Shared with third parties: No (processors such as the email provider count as service providers, not sharing).
  - Encrypted in transit: Yes. Users can request deletion: Yes.
- **Account deletion URL:** https://app.edgeletter.blog/delete-account
- **Financial features:** None. **Government app:** No. **Health:** No.

## Releases

1. Create the app in Play Console with package `blog.edgeletter`.
2. In **Users and permissions**, give the Play service account used by Codemagic access to the app (Release manager).
3. First release: run the Codemagic workflow once, download the `app-release.aab` artifact and upload it by hand to **Internal testing** (Play needs one manual upload on a new app). Later runs publish by themselves.
