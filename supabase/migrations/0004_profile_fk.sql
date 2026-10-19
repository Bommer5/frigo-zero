-- Relation membres -> profils (affichage des noms/avatars dans l'app via PostgREST)
alter table public.household_members add constraint household_members_profile_fk foreign key (user_id) references public.profiles (id);
alter table public.consumption_log add constraint consumption_log_profile_fk foreign key (user_id) references public.profiles (id) on update cascade on delete set null;
