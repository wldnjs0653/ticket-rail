-- Local demo only; the UI uses app_user.id=1 without a login flow.
-- This unusable password marker is not a real login credential.
INSERT INTO public.app_user (id, email, password_hash)
VALUES (1, 'demo@example.invalid', 'LOCAL_DEMO_NO_LOGIN')
ON CONFLICT (id) DO NOTHING;
SELECT setval('public.app_user_id_seq', GREATEST(1, (SELECT MAX(id) FROM public.app_user)));
-- GET /events?date=YYYY-MM-DD generates dated trains and priced seats.
