import { createContext, useContext } from "react";

/**
 * True while a page is rendered as a tab inside a `WorkspaceShell` that shows
 * its own title. Page headers read it to step down to a section heading, so a
 * screen never stacks two page-sized titles ("Vendors" over "Vendors &
 * Restaurants").
 */
export const WorkspaceContext = createContext(false);

export const useInWorkspace = () => useContext(WorkspaceContext);
