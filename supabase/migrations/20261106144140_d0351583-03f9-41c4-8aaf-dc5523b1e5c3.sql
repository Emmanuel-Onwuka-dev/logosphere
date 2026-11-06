revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.has_church_role(uuid, uuid, public.app_role) from public, anon;
revoke execute on function public.is_church_member(uuid, uuid) from public, anon;
revoke execute on function public.create_church(text,text,text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_church_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.is_church_member(uuid, uuid) to authenticated;