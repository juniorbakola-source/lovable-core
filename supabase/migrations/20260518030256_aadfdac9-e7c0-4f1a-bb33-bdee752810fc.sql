DO $$ DECLARE cid uuid; BEGIN
  SELECT company_id INTO cid FROM profiles WHERE id='6f06f2c2-7bb5-44d5-9bd6-eb5def48c816';
  IF cid IS NULL THEN
    INSERT INTO companies(name) VALUES('Default Company') RETURNING id INTO cid;
    INSERT INTO profiles(id, company_id, role) VALUES('6f06f2c2-7bb5-44d5-9bd6-eb5def48c816', cid, 'planner') ON CONFLICT (id) DO UPDATE SET company_id=EXCLUDED.company_id;
  END IF;
  DELETE FROM skus WHERE user_id='6f06f2c2-7bb5-44d5-9bd6-eb5def48c816';
END $$;