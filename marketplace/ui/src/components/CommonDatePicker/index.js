import React, { useCallback, useState } from "react";
import { Button, DatePicker, FormLayout, Label, Popover, Stack } from "@shopify/polaris";
import { CalendarMajor } from '@shopify/polaris-icons';
import dayjs from "dayjs";

const CommonDatePicker = ({ label, initialDate, getDateCallback, fullWidth }) => {
  const [calendarPopupActive, setCalendarPopupActive] = useState(false);

  const toggleCalendarPopup = useCallback(
    () => setCalendarPopupActive((calendarPopupActive) => !calendarPopupActive),
    []
  );

  const [{ month, year }, setDate] = useState({
    month: dayjs().month(),
    year: dayjs().year(),
  });

  const handleMonthChange = useCallback(
    (month, year) => setDate({ month, year }),
    []
  );

  return (
    <Stack vertical spacing="extraTight">
      <Label>
        <div style={{ marginBottom: '1px' }}>
          {label ? label : "Date"}
        </div>
      </Label>
      <Popover
        active={calendarPopupActive}
        activator={
          <Button
            outline
            icon={CalendarMajor}
            onClick={toggleCalendarPopup}
            fullWidth={fullWidth}
          >
            {dayjs(initialDate.start).format("MMMM Do, YYYY")}
          </Button>
        }
        onClose={toggleCalendarPopup}
        ariaHaspopup={false}
        sectioned
      >
        <FormLayout>
          <DatePicker
            month={month}
            year={year}
            onChange={(value) => {
              getDateCallback(value);
              toggleCalendarPopup();
            }}
            onMonthChange={handleMonthChange}
            selected={initialDate}
          />
        </FormLayout>
      </Popover>
    </Stack>
  );
};

export default CommonDatePicker;
