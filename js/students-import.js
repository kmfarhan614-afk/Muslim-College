/* ==========================================================================
   students-import.js — official COM SCI-I (2026) roster (1st Year Computer
   Science, session 2026-2027).
   --------------------------------------------------------------------------
   Transcribed verbatim from
   "Muslim_College_COM_SCI_I_2026_Detailed_Transcript (3).txt".
   Loaded ONLY on authenticated pages — never on the public sign-in page.

   Columns: [Student ID, Student Name, Father's Name, Phone (Res.),
             Mobile, Permanent Address, flags]
     • Phone numbers are kept as strings so leading zeros are preserved.
     • "Not listed" mobiles are stored as '' (empty).
     • "verify:*" flags a printed number that needs manual verification.
     • "review:address" flags an unclear/unreadable permanent address.
   Roll numbers, dates of birth, gender, CNIC and email are deliberately NOT
   invented — they are left blank until verified values are provided.

   For production hosting, replace this static import with a protected
   database import (Supabase) so the roster is not published as a JS asset.
   ========================================================================== */

'use strict';

window.MCA_CS_ROSTER = [
  ['2384', 'AWAIS KHAN', 'ABDUL WAHAB', '03101969989', '', 'LATIF ABAD STREET NO. 32, PESHAWAR', ''],
  ['2387', 'MUHAMMAD AMAN', 'AMIN ATHER', '03139973050', '03175951108', 'PESHAWAR', ''],
  ['2388', 'MUHAMMAD AFAQ', 'MINHAJ KHAN', '03339119857', '', 'VILLAGE [UNCLEAR] BAYAN, NEAR [UNCLEAR] SUGAR MILL, PESHAWAR', 'review:address'],
  ['2395', 'UZAIR KHAN', 'TILAWAT KHAN', '03449188274', '03322575740', '[UNCLEAR] ROAD, TEHKAL 4, DIST. PESHAWAR', 'review:address'],
  ['2396', 'ADIL UR REHMAN', 'ABID UR REHMAN', '03169714808', '03459388657', 'MOTORWAY SERVICE ROAD, SARDAR GARHI, PESHAWAR', ''],
  ['2409', 'FAIZ ULLAH', 'ABDUL MANAN', '03329207770', '03319185616', 'AFGHAN COLONY, PESHAWAR', ''],
  ['2410', 'ILHAM UR RAHMAN', 'HAMID UR RAHMAN', '03240581772', '03240587772', 'AFGHAN COLONY, PESHAWAR', ''],
  ['2411', 'KALEEM ULLAH', 'FAZAL MAULA', '03285745114', '03358551259', 'AFGHAN COLONY, PESHAWAR', ''],
  ['2413', 'MUHAMMAD FARHAN', 'MUHAMMAD USMAN', '03119088229', '03319088229', 'KHAZANA SUGAR MILL, CHARSADDA ROAD, PESHAWAR', ''],
  ['2434', 'MUHAMMAD KAMRAN', 'KASHMIR KHAN', '03452299454', '03359417577', 'SHALAM [UNCLEAR] DAUDZAI, BACK SIDE, PESHAWAR', 'review:address'],
  ['2436', 'BILAL AHMAD', 'RIAZ ULLAH', '03190318843', '03105652464', 'PESHAWAR', ''],
  ['2442', 'ADIL', 'SALIH MUHAMMAD', '03159232416', '03161596574', '[UNCLEAR] GHAR SHALAM, PESHAWAR', 'review:address'],
  ['2443', 'SOHAIL', 'SALIH MUHAMMAD', '03159232411', '', '[UNCLEAR] GHAR SHALAM PUL, PESHAWAR', 'review:address'],
  ['2449', 'MUHAMMAD ZAID KHALIL', 'SHAHID AKBAR KHALIL', '03138686450', '03141518193', 'PESHAWAR', ''],
  ['2450', 'SANGEEN KHAN', 'MUHAMMAD SABIR', '03189434975', '', 'PESHAWAR', ''],
  ['2452', 'MUSTAFA UR REHMAN', 'FASIH UR REHMAN', '03339357148', '03190176634', 'KOHATI, PESHAWAR', ''],
  ['2458', 'MUHAMMAD DAWOOD', 'MUHAMMAD AMAJ UD DIN', '03139780950', '', '', 'review:address'],
  ['2463', 'MUHAMMAD NIZAM', 'ZAHIR ULLAH', '03169000360', '03105200815', 'PESHAWAR', ''],
  ['2469', 'MUHAMMAD UZAIR KHAN', 'ZAIN ULLAH', '03159619287', '03059359775', 'PESHAWAR', ''],
  ['2471', 'SAQIB ALI', 'SAEED ALI', '03119511103', '03219129803', 'CIRCULAR ROAD, PESHAWAR', ''],
  ['2473', 'MUHAMMAD MUJTABA', 'MUHAMMAD RIZWAN', '03369737998', '', 'PESHAWAR', ''],
  ['2474', 'RAHEEM SHAH', 'SAID KARIM', '03390034552', '', 'PESHAWAR', ''],
  ['2475', 'DANISH KHAN', 'HAYAT ULLAH', '03332585033', '', 'PESHAWAR', ''],
  ['2482', 'MUHAMMAD ZAIN QURESHI', 'KHALID USMAN', '03345268438', '03339191705', 'PESHAWAR', ''],
  ['2483', 'HAMZA', 'SHAH NAWAZ', '03345268438', '23339191705', 'PESHAWAR', 'verify:mobile'],
  ['2484', 'MUHAMMAD OWAIS IRFAN', 'MUHAMMAD IRFAN NAEEM', '03709965726', '03123772288', 'JANDA BAZAR, PESHAWAR', ''],
  ['2487', 'MUHAMMAD ZAID', 'INAYAT ULLAH', '03199951130', '03009333231', 'NISHTAR ABAD CHOWK, PESHAWAR', ''],
  ['2497', 'MUHAMMAD FIDA', 'MUHAMMAD ATTA ULLAH', '03139784136', '03275317389', 'RABAT, TIMERCARA, DIR LOWER', ''],
  ['2500', 'SYED ARSALAN SHAH BUKHARI', 'SYED NASIR ALI SHAH BUKHARI', '03194975747', '03149059559', 'PESHAWAR', ''],
  ['2503', 'MUHAMMAD KABIR KHAN', 'JAFFAR KHAN', '0305581019', '03275332729', 'PESHAWAR', 'verify:phoneRes'],
  ['2507', 'MUHAMMAD HASHIR', 'ASIF ALI', '03159649115', '03176001292', 'TAKHTA ABAD AWAL, PESHAWAR', ''],
  ['2515', 'NAEEM ULLAH R', 'MEER ALAM', '03409722903', '', 'DHOOP JIJAL, LOWER KOHISTAN', ''],
  ['2516', 'MUHAMMAD ADIL R', 'MUHAMMAD RAFIQ', '03367555157', '', 'KHYBER AGENCY, PAINDI, LALMA-2', '']
];

/* Run the one-time, idempotent import once the app (and any server hydrate)
   has finished seeding — before the page script renders. */
document.addEventListener('DOMContentLoaded', () => onAppReady(() => Seed.ensureCsImport()));
