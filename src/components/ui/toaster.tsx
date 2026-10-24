"use client"

import {
  Toaster as ChakraToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
  createToaster,
} from "@chakra-ui/react"
import TaskProgressPanel from '../Account/TaskProgressPanel'

export const toaster = createToaster({
  placement: "top-end",
  duration: 2500,
  max: 3,
})

export const Toaster = () => {
  return (
    <Portal>
      <TaskProgressPanel />
      <ChakraToaster toaster={toaster} insetInline={{ md: "4" }}>
        {(toast) => (
          <Toast.Root width={{ md: "sm" }} flexDirection="row" onClick={() => toaster.dismiss(toast.id)} cursor="pointer">
            {toast.type === "loading" ? (
              <Spinner size="sm" color="blue.solid" />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && (
                <Toast.Description>{toast.description}</Toast.Description>
              )}
            </Stack>
            {toast.action && (
              <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
            )}
            <Toast.CloseTrigger />
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  )
}
