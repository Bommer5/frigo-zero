-- Droit à l'effacement (RGPD) : l'utilisateur supprime son compte et toutes ses données.
-- Les foyers dont il était le seul membre disparaissent ; sinon la propriété passe au plus ancien membre.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.household_members m set role = 'owner'
  where m.role = 'member' and m.user_id = (
    select m2.user_id from public.household_members m2
    where m2.household_id = m.household_id and m2.user_id <> uid order by m2.joined_at limit 1)
    and m.household_id in (select household_id from public.household_members where user_id = uid and role = 'owner');
  delete from public.households h where h.id in (select household_id from public.household_members where user_id = uid)
    and not exists (select 1 from public.household_members o where o.household_id = h.id and o.user_id <> uid);
  delete from auth.users where id = uid;
end $$;
revoke execute on function public.delete_my_account from anon, public;
grant execute on function public.delete_my_account to authenticated;
