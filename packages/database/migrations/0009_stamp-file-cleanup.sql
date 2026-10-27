CREATE TRIGGER files_clear_stamps BEFORE DELETE ON files BEGIN
  UPDATE settings SET
    paid_stamp_file_id=CASE WHEN paid_stamp_file_id=OLD.id THEN NULL ELSE paid_stamp_file_id END,
    unpaid_stamp_file_id=CASE WHEN unpaid_stamp_file_id=OLD.id THEN NULL ELSE unpaid_stamp_file_id END,
    due_stamp_file_id=CASE WHEN due_stamp_file_id=OLD.id THEN NULL ELSE due_stamp_file_id END
  WHERE paid_stamp_file_id=OLD.id OR unpaid_stamp_file_id=OLD.id OR due_stamp_file_id=OLD.id;
END;
