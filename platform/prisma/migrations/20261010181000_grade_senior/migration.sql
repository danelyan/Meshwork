-- Грейд Senior (ADR 0003, дополнение 10.10 16:15). Значение после middle: порядок enum = порядок грейдов.
ALTER TYPE "Grade" ADD VALUE 'senior' AFTER 'middle';
